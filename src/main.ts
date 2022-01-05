// SPDX-License-Identifier: ISC
/*
 * Copyright (c) 2021, 2022 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

import rte from "rtennui/rtennui.min.js";
const prot = rte.protocol;

import * as room from "./room.js";

/**
 * A function to accept logins. Should return either an object with a `room`
 * and `info` field or `null` to reject the login. The `room` field contains
 * the string name of the room to join, and the `info` field contains any
 * public information about the peer, such as their name.
 */
type AcceptLoginFunction = (credentials: any) => Promise<{
    room: string,
    info: any
}>;

/**
 * The RTEnnui server. There should be one instance of this for an entire
 * system.
 */
export class RTEnnuiServer {
    constructor(
        /**
         * Function to call to accept (or reject) a login, given its
         * credentials. Should return a room, or null to reject the login. If
         * no room exists with the given name, one will be created.
         */
        private _acceptLogin: AcceptLoginFunction
    ) {
        this._rooms = Object.create(null);
    }

    /**
     * Accept a new connection.
     * @param socket  The WebSocket which has just received a connection.
     */
    async acceptConnection(socket: WebSocket) {
        function die() {
            socket.close();
        }

        // Wait for a login message
        const ab = await new Promise<Buffer>(res => {
            let done = false;
            socket.addEventListener("message", ev => {
                done = done || (res(ev.data), true);
            });
            socket.addEventListener("close", () => {
                done = done || (res(null), true);
            });
            socket.addEventListener("error", () => {
                done = done || (res(null), true);
            });
        });
        if (!ab)
            return die();
        const msg = Buffer.from(ab);

        // The message must be a login
        if (msg.length < 4)
            return die();
        const cmd = msg.readUInt16LE(2);
        if (cmd !== prot.ids.login)
            return die();

        // The data must be a JSON object
        let login: any = null;
        try {
            login = JSON.parse(msg.toString("utf8", prot.parts.login.data));
        } catch (ex) {}
        if (typeof login !== "object" || login === null)
            return die();

        // We only check credentials here
        if (!login.credentials)
            return die();

        // Check the credentials
        const accept = await this._acceptLogin(login.credentials);
        if (!accept || !accept.room)
            return die();

        // Check for a room
        if (!(accept.room in this._rooms))
            this._rooms[accept.room] = new room.Room();
        this._rooms[accept.room].accept(socket, login, accept.info);
    }

    /**
     * All of the current rooms.
     */
    private _rooms: Record<string, room.Room>;
}
