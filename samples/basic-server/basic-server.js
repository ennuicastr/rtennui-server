#!/usr/bin/env node

import * as rte from "../../src/main.js";

import * as fsc from "fs";
import * as http from "http";

import * as ws from "ws";

const fs = fsc.promises;

const rtes = new rte.RTEnnuiServer(acceptLogin);
const wss = new ws.WebSocketServer({noServer: true});
const server = http.createServer(httpConnection);

server.on("upgrade", onUpgrade);
server.listen(8043);

/**
 * HTTP connection handler.
 * @param {Request} req  HTTP request
 * @param {Response} res  HTTP response
 */
async function httpConnection(req, res) {
    let url = (new URL(req.url, "http://example.com")).pathname;

    if (url === "/rtennui.js" || url === "/rtennui.min.js")
        url = "/../../../../rtennui" + url;

    if (url.endsWith("/"))
        url += "index.html";

    let extR = /\.[^\.]*$/.exec(url);
    let ext = extR ? extR[0] : "";

    const f = "root" + url;
    try {
        const cont = await fs.readFile(f);
        res.writeHead(200, {
            "content-type": (ext === ".js") ? "text/javascript" : "text/html",
            "content-length": cont.length
        });
        res.end(cont);

    } catch (ex) {
        res.writeHead(404, {
            "content-type": "text/plain"
        });
        res.end("404");

    }
}

/**
 * Called on a connection that upgrades.
 * @param {Request} req  HTTP request
 * @param {Socket} sock  Underlying HTTP socket
 * @param {Headers} head  Headers
 */
function onUpgrade(req, sock, head) {
    if (req.url !== "/ws") {
        sock.destroy();
        return;
    }
    wss.handleUpgrade(req, sock, head, ws => {
        rtes.acceptConnection(ws);
    });
}

/**
 * Accept logins from the client. There is no verification here, so all logins
 * are accepted.
 * @param credentials  Login credentials.
 */
function acceptLogin(credentials) {
    return Promise.resolve({
        room: credentials.room || "RTEnnui",
        info: credentials.info || {name: "Anonymous"}
    });
}
