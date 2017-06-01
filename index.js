#!/usr/bin/env node

'use strict';

var program = require('commander');
var http = require('https');
var faker = require('faker');

program
  .usage("<command> [options]")
  .description("Valid commands are : create, cleanup")
  .option("-t, --token <access_token>", "The 3scale Access Token")
  .option("-h, --host <host>", "The 3scale Admin host (ex: acme-admin.3scale.net) ")
  .option("-a, --applications <n>", "The number of applications to create in each account", parseInt)
  .option("-c, --accounts <n>", "The number of accounts to create", parseInt)
  .option("-u, --users <n>", "The number of users to create in each account", parseInt)
  .option("-v, --verbose", "Be verbose")
  .option("-l, --loghttp", "Log HTTP requests")
  .parse(process.argv);


// Optional arguments
var n_applications = program.applications || 0;
var n_accounts = program.accounts || 0;
var n_users = program.users || 0;
var trace_http = (program.loghttp != null);
var verbose = (program.verbose != null);

// Mandatory arguments
var action = program.args.length > 0 ? program.args[0] : "";
var host = program.host
var access_token = program.token;

// The available application plans
var plans = [];


function check_mandatory_options() {
  if (program.host == null || program.host == "") {
    console.error("The --host option is mandatory !");
    process.exit(1);
  }
  if (program.token == null || program.token == "") {
    console.error("The --token option is mandatory !");
    process.exit(1);
  }
}

if (action == "create") {
  check_mandatory_options();
  do_http("GET", "/admin/api/application_plans.json", {}, process_plans);
} else if (action == "cleanup") {
  check_mandatory_options();
  do_http("GET", "/admin/api/accounts.json", {}, delete_accounts);
} else {
  console.log("Valid commands are : create, cleanup");
}



function do_http(method, path, params, callback) {
  var options = {
    host: host,
    method: method,
    path: path
  };

  var encoded_params = "";
  if (params != null) {
    var tuples = [];
    for (var key in params) {
      if (params.hasOwnProperty(key)) {
        tuples.push(encodeURIComponent(key) + "=" + encodeURIComponent(params[key]));
      }
    }
    encoded_params = tuples.join("&");
  }

  if (trace_http) {
    console.log(options.method + " " + options.path + "?access_token=<HIDDEN>" + ((method == "POST" || method == "PUT") ? "" : "&" + encoded_params));
  }

  options.path += "?access_token=" + access_token;
  if (method == "GET") {
    options.path += "&" + encoded_params;
  }
  var req = http.request(options, function(response) {
    var data = '';

    //another chunk of data has been recieved, so append it to `str`
    response.on('data', function (chunk) {
      data += chunk;
    });

    //the whole response has been recieved, so we just print it out here
    response.on('end', function () {
      var json_response = JSON.parse(data);
      callback(json_response);
    });
  });

  req.on('error', function (e) {
    // General error, i.e.
    //  - ECONNRESET - server closed the socket unexpectedly
    //  - ECONNREFUSED - server did not listen
    //  - HPE_INVALID_VERSION
    //  - HPE_INVALID_STATUS
    //  - ... (other HPE_* codes) - server returned garbage
    console.log(e);
  });
  req.on('timeout', function () {
    // Timeout happend. Server received request, but not handled it
    // (i.e. doesn't send any response or it took to long).
    // You don't know what happend.
    // It will emit 'error' message as well (with ECONNRESET code).

    console.log('timeout');
    req.abort();
  });

  if (method == "POST" || method == "PUT") {
    req.write(encoded_params);
    if (trace_http) {
      console.log(encoded_params);
      console.log();
    }
  }

  req.end();
}

function get_a_user() {
  var first_name = faker.name.firstName();
  var last_name = faker.name.lastName();
  return {
    username: faker.internet.userName(first_name, last_name),
    email: faker.internet.email(first_name, last_name, "example.test"),
    password: faker.internet.password(),
    name: faker.name.findName(first_name, last_name),
    "x-created-by": "script"
  };
}

function get_an_application() {
  return {
    name: faker.commerce.productName(),
    description: faker.company.catchPhrase(),
    "x-created-by": "script"
  };
}

function get_an_account() {
  return {
    org_name: faker.company.companyName(),
    "x-created-by": "script"
  };
}

function process_plans(json) {
  for (var i in json.plans) {
    var plan = json.plans[i].application_plan;
    if (verbose) {
      console.log("Found an application plan : " + plan.name);
    }
    plans.push(plan.id);
  }

  if (verbose) {
    console.log("Creating %j accounts...", n_accounts);
  }
  for (var i = 0; i < n_accounts; i++) {
    var options = get_a_user();
    options.org_name = get_an_account().org_name;

    do_http("POST", "/admin/api/signup.json", options, activate_account);
  }
}

function activate_account(json) {
  log(json);

  if (json.account.state == "created") {
    do_http("PUT", "/admin/api/accounts/"+encodeURIComponent(json.account.id)+"/approve.json", {}, create_account_inner_objects);
  } else {
    create_account_inner_objects(json);
  }
}

function create_account_inner_objects(json) {
  create_applications(json);
  create_users(json);
}

function log(object, action) {
  if (verbose) {
    action = action || "create";
    var type = "unknown";
    for (var key in object) {
      if (object.hasOwnProperty(key)) {
        type = key;
        break;
      }
    }

    var name = object[type].name || object[type].username || object[type].org_name || "unknown";
    console.log("Just "+action+"d a '"+type+"' with id = "+object[type].id + " and name = "+name);
  }
}

function create_applications(json) {
  for (var i = 0; i < n_applications; i++) {
    var options = get_an_application();
    options.plan_id = plans[Math.floor(Math.random()*plans.length)]; // pick a plan at random

    do_http("POST", "/admin/api/accounts/"+encodeURIComponent(json.account.id)+"/applications.json", options, log);
  }
}

function create_users(json) {
  for (var i = 0; i < n_users; i++) {
    var options = get_a_user();

    do_http("POST", "/admin/api/accounts/"+encodeURIComponent(json.account.id)+"/users.json", options, (json_user) => { activate_user(json_user, json.account.id); });
  }
}

function activate_user(json, account_id) {
  log(json);
  if (json.user.state == "pending") {
    do_http("PUT", "/admin/api/accounts/"+encodeURIComponent(account_id)+"/users/"+encodeURIComponent(json.user.id)+"/activate.json", {}, (json) => {});
  }
}

function delete_accounts(json) {
  for (var i in json.accounts) {
    var account = json.accounts[i];
    if (account.account["x-created-by"] == "script") {
      delete_account(account);
    }
  }
}
function delete_account(json) {
  do_http("DELETE", "/admin/api/accounts/"+encodeURIComponent(json.account.id)+".json", {}, () => {log(json, "delete");});
}
