const fs = require("fs");
const rte = await import(process.env.HOME + "/rtennui-server/src/main.js");

if (!module.rtes)
    module.rtes = new rte.RTEnnuiServer(acceptLogin);
const rtes = module.rtes;

rtes.acceptConnection(sock);

/**
 * Accept logins from the client. There is no verification here, so all logins
 * are accepted.
 * @param credentials  Login credentials
 */
function acceptLogin(credentials) {
    return Promise.resolve(credentials.room || "RTEnnui");
}
