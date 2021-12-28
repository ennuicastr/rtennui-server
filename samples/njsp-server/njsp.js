#!/usr/bin/env node
const njsp = require("nodejs-server-pages");
const root = {
    "default": "ws"
};
njsp.createWSServer({root});
