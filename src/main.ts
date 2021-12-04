/*
 * Copyright (c) 2021 Yahweasel
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

export class RTEnnuiServer {
    constructor(private _acceptLogin: (credentials: any) => Promise<string>) {
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
        const roomID = await this._acceptLogin(login.credentials);
        if (!roomID)
            return die();

        // Check for a room
        if (!(roomID in this._rooms))
            this._rooms[roomID] = new room.Room();
        this._rooms[roomID].accept(socket, login);
    }

    /**
     * All of the current rooms.
     */
    private _rooms: Record<string, room.Room>;
}
