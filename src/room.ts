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

/**
 * An individual in a room. Only used internally.
 */
class Member {
    constructor(
        public room: Room,
        public id: number,
        public socket: WebSocket,
        public transmit: string[],
        public receive: string[]
    ) {
        this.name = "";
        this.receiveSet = new Set(receive);
        this.streamId = -1;
        this.stream = null;

        socket.onmessage = ev => this.onReliableMessage(ev);
    }

    /**
     * Disconnect this member.
     */
    close() {
        console.error(new Error().stack);
        this.socket.close();
        this.room.removeMember(this);
    }

    /**
     * Called when a message is received over the reliable socket.
     */
    onReliableMessage(ev: MessageEvent) {
        const msg = new Buffer(ev.data);
        if (msg.length < 4)
            return this.close();
        const peer = msg.readInt16LE(0);
        const cmd = msg.readUInt16LE(2);

        switch (cmd) {
            case prot.ids.stream:
            {
                const p = prot.parts.stream;
                if (msg.length < p.length)
                    return this.close();
                const streamId = msg.readUInt8(p.id);
                let streamInfo: any[] = null;
                try {
                    streamInfo = JSON.parse(msg.toString("utf8", p.data));
                } catch (ex) {}
                if (typeof streamInfo !== "object" || streamInfo === null)
                    return this.close();

                if (streamInfo.length === 0) {
                    // If it's an empty array, this is a non-stream
                    this.streamId = -1;
                    this.stream = null;
                } else {
                    // Validate it
                    for (let i = 0; i < streamInfo.length; i++) {
                        if (typeof streamInfo[i] !== "object" ||
                            streamInfo[i] === null)
                            return this.close();
                        if (typeof streamInfo[i].codec !== "string" ||
                            typeof streamInfo[i].frameDuration !== "number")
                            return this.close();
                    }
                    this.streamId = streamId;
                    this.stream = streamInfo;
                }

                // Pass it on
                msg.writeUInt16LE(this.id, 0);
                this.room.relay(msg, {except: this.id});
                break;
            }

            case prot.ids.data:
                // FIXME: Some validation
                msg.writeUInt16LE(this.id, 0);
                this.room.relay(msg, {except: this.id});
                break;

            default:
                console.error(`Unrecognized command ${cmd.toString(16)}`);
                this.close();
        }
    }

    name: string;
    receiveSet: Set<string>;
    streamId: number;
    stream: string[];
}

export class Room {
    constructor() {
        this._members = [];
    }

    /**
     * Accept a new connection into this room.
     * @param socket  The WebSocket.
     * @param login  Login information. Credentials have already been checked.
     */
    accept(socket: WebSocket, login: any) {
        function die() {
            socket.close();
        }

        // Get the transmit and receive info
        let t: string[] = null;
        let r: string[] = null;
        try {
            t = login.transmit.map((x: any) => "" + x);
            r = login.receive.map((x: any) => "" + x);
        } catch (ex) {}
        if (!t || !r)
            return die();

        // Find a slot
        let idx = 0;
        for (; idx < this._members.length && this._members[idx]; idx++) {}
        if (idx >= this._members.length)
            this._members.push(null);

        // Choose a name for them
        let name: string = "" + (idx+1);
        try {
            if (login.credentials.name)
                name = "" + login.credentials.name;
        } catch (ex) {}

        // Make the member
        const member = this._members[idx] =
            new Member(this, idx, socket, t, r);
        member.name = name;

        // Make sure we have *something* in common
        if (!this._resolveFormats({dryRun: true})) {
            member.close();
            this._members[idx] = null;
            return;
        }

        // Ack them
        {
            const msg = Buffer.alloc(4);
            msg.writeUInt16LE(idx, 0);
            msg.writeUInt16LE(prot.ids.ack, 2);
            socket.send(msg.buffer);
        }

        // And tell everyone else about them
        {
            const p = prot.parts.peer;
            const info = Buffer.from('{"name":""}');
            const msg = Buffer.alloc(p.length + info.length);
            msg.writeUInt16LE(idx, 0);
            msg.writeUInt16LE(prot.ids.peer, 2);
            msg.writeUInt8(1, p.status);
            info.copy(msg, p.data);
            this.relay(msg, {except: idx});
        }

        // Finish resolving the formats
        this._resolveFormats();
    }

    /**
     * Remove a member from this room.
     */
    removeMember(member: Member) {
        const idx = this._members.indexOf(member);
        if (idx < 0)
            return;
        this._members.splice(idx, 1);

        // ...
    }

    /**
     * Relay data to all members in the room.
     */
    relay(msg: Buffer, opts: {
        except?: number,
        reliable?: boolean
    } = {}) {
        const except = (typeof opts.except === "number") ? opts.except : -1;
        const reliable =
            (typeof opts.reliable === "boolean") ? opts.reliable : true;

        for (let i = 0; i < this._members.length; i++) {
            if (i === except)
                continue;
            const member = this._members[i];
            // FIXME: Reliability
            member.socket.send(msg);
        }
    }

    /**
     * Figure out what formats are supported. Returns true if there is at least
     * one video format and at least one audio format supported for both
     * transmission and receipt by all clients.
     * @param opts  Options. In particular, whether to do a dry run.
     */
    private _resolveFormats(opts: {dryRun?: boolean} = {}) {
        let r: string[] = null;
        let first = true;

        // Find the formats that everyone can receive
        for (const member of this._members) {
            if (!member)
                continue;

            if (first) {
                // Start with them
                r = member.receive.slice(0);
            } else {
                // Intersect them
                const mr = member.receiveSet;
                r = r.filter(x => mr.has(x));
            }
        }
        const rs = new Set(r);

        /* Make sure everyone can transmit at least one video format and one
         * audio format that everyone can receive */
        let success = true;
        for (const member of this._members) {
            if (!member)
                continue;

            const t = member.transmit.filter(x => rs.has(x));

            // Find formats
            let v = false, a = false;
            for (const f of t) {
                if (f[0] === "v")
                    v = true;
                else if (f[0] === "a")
                    a = true;
                if (v && a)
                    break;
            }

            if (!v || !a) {
                success = false;
                break;
            }
        }

        // Update
        if (!opts.dryRun) {
            // Determine if the formats have actually changed
            if (JSON.stringify(this._formats) !== JSON.stringify(r)) {
                // Set the new formats
                this._formats = r;

                // Send them to everyone
                const p = prot.parts.formats;
                const formats = Buffer.from(JSON.stringify(r));
                const buf = Buffer.alloc(p.length + formats.length);
                buf.writeUInt16LE(prot.ids.formats, 2);
                formats.copy(buf, p.data);
                for (const member of this._members) {
                    if (!member)
                        continue;
                    member.socket.send(buf);
                }
            }
        }

        return success;
    }

    /**
     * The current acceptable formats.
     */
    private _formats: string[];

    /**
     * All members. null if they've disconnected.
     */
    private _members: Member[];
}
