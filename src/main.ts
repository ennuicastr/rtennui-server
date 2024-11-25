// SPDX-License-Identifier: ISC
/*
 * Copyright (c) 2021-2024 Yahweasel
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

import rte from "rtennui/dist/rtennui.min.js";
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
        this._secondConnectionCBs = Object.create(null);
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

        // The message must be a login or a wscLogin (second connection login)
        if (msg.length < 4)
            return die();
        const cmd = msg.readUInt16LE(2);
        if (cmd === prot.ids.wscLogin)
            return this._acceptSecondConnection(socket, msg);
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
            this._rooms[accept.room] = new room.Room(accept.room, this);
        this._rooms[accept.room].accept(socket, login, accept.info);
    }

    /**
     * @private
     * Accept a secondary connection.
     */
    private async _acceptSecondConnection(socket: WebSocket, msg: Buffer) {
        function die() {
            socket.close();
        }

        const p = prot.parts.wscLogin;
        if (msg.byteLength < p.length)
            return die();

        const key = new Uint8Array(msg.slice(p.key, p.key + 8));
        const keyStr = key.toString();
        const cb = this._secondConnectionCBs[keyStr];
        if (!cb)
            return die();
        delete this._secondConnectionCBs[keyStr];
        cb(socket, key);
    }

    /**
     * @private
     * Register a secondary connection and get an appropriate key.
     */
    registerSecondConnection(
        cb: (socket: WebSocket, key: Uint8Array)=>unknown,
        keyLength = 8
    ): Uint8Array {
        const key = new Uint8Array(keyLength);

        while (true) {
            for (let i = 0; i < key.length; i++)
                key[i] = Math.random() * 0x100;
            const keyStr = key.toString();
            if (!this._secondConnectionCBs[keyStr]) {
                this._secondConnectionCBs[keyStr] = cb;
                return key;
            }
        }
    }

    /**
     * @private
     * Deregister an unused secondary connection key.
     */
    deregisterSecondConnectionKey(key: Uint8Array) {
        const keyStr = key.toString();
        delete this._secondConnectionCBs[keyStr];
    }

    /**
     * @private
     * Called when a room is empty to destroy it.
     */
    roomEmpty(r: room.Room) {
        delete this._rooms[r.id];
    }

    /**
     * Callbacks for later secondary connections.
     */
    private _secondConnectionCBs: Record<
        string,
        (socket: WebSocket, key: Uint8Array)=>unknown
    >;

    /**
     * All of the current rooms.
     */
    private _rooms: Record<string, room.Room>;
}
