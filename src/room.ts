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

import * as net from "./net.js";
import * as util from "./util.js";

import rte from "rtennui/rtennui.js";
const prot = rte.protocol;
import wrtc from "wrtc";

/**
 * An individual in a room. Only used internally.
 */
class Member {
    constructor(
        /**
         * The room this member is in.
         */
        public room: Room,

        /**
         * The ID of this member.
         */
        public id: number,

        /**
         * The reliable socket for this member.
         */
        public socket: WebSocket,

        /**
         * Formats this user can transmit.
         */
        public transmit: string[],

        /**
         * Formats this user can receive.
         */
        public receive: string[]
    ) {
        this.name = "";
        this.receiveSet = new Set(receive);
        this.p2p = new Set();
        this.streamId = -1;
        this.stream = null;
        this.unreliable = null;
        this.unreliableMakingOffer = false;
        this.unreliableIgnoreOffer = false;

        const peer = this.unreliableP =
            <RTCPeerConnection> new wrtc.RTCPeerConnection({
                iceServers: util.iceServers
            });

        socket.onmessage = ev => this.onMessage(ev);
        socket.onclose = () => this.close();

        peer.onnegotiationneeded = async ev => {
            // Perfect negotiation pattern
            try {
                this.unreliableMakingOffer = true;
                await peer.setLocalDescription(
                    await peer.createOffer());

                const p = prot.parts.rtc;
                const info = Buffer.from(JSON.stringify(
                    {description: peer.localDescription}
                ));
                const msg = net.createPacket(
                    p.length + info.length,
                    65535, prot.ids.rtc,
                    [[p.data, info]]
                );
                this.socket.send(msg);

            } catch (ex) {
                //console.error(ex);

            }

            this.unreliableMakingOffer = false;
        };

        peer.onicecandidate = ev => {
            const p = prot.parts.rtc;
            const info = Buffer.from(JSON.stringify(
                {candidate: ev.candidate}
            ));
            const msg = net.createPacket(
                p.length + info.length,
                65535, prot.ids.rtc,
                [[p.data, info]]
            );

            try {
                this.socket.send(msg);
            } catch (ex) {
                this.close();
            }
        };

        peer.ondatachannel = ev => {
            const chan = ev.channel;
            chan.binaryType = "arraybuffer";

            chan.addEventListener("open", () => {
                this.unreliable = chan;
            }, {once: true});

            chan.addEventListener("close", () => {
                if (this.unreliable === chan)
                    this.unreliable = null;
            }, {once: true});

            chan.onmessage = ev => this.onUnreliableMessage(ev);
        };
    }

    /**
     * Disconnect this member.
     */
    close() {
        if (this.socket)
            this.socket.close();
        if (this.unreliable)
            this.unreliable.close();
        this.room.removeMember(this);

        this.socket = null;
        this.unreliable = null;
    }

    /**
     * Called when a message is received. Called directly for reliable,
     * indirectly for unreliable.
     */
    onMessage(ev: MessageEvent, reliable = true) {
        const msg = new Buffer(ev.data);
        if (msg.length < 4)
            return this.close();
        const peer = msg.readUInt16LE(0);
        const cmd = msg.readUInt16LE(2);

        switch (cmd) {
            case prot.ids.rtc:
            {
                const p = prot.parts.rtc;
                if (msg.length < p.length)
                    return this.close();

                if (peer === 65535 /* max u16 */) {
                    // RTC connection to *us*
                    this.rtcMessage(msg);

                } else {
                    // RTC connection to another peer
                    msg.writeUInt16LE(this.id, 0);
                    this.room.send(peer, msg);

                }
                break;
            }

            case prot.ids.peer:
            {
                const p = prot.parts.peer;
                if (msg.length < p.length)
                    return this.close();
                const status = !!msg.readUInt8(p.status);
                if (status)
                    this.p2p.add(peer);
                else
                    this.p2p.delete(peer);
                break;
            }

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
                this.room.relay(msg, {
                    except: this.id,
                    p2p: this.p2p
                });
                break;
            }

            case prot.ids.data:
                // FIXME: Some validation
                msg.writeUInt16LE(this.id, 0);
                this.room.relay(msg, {
                    except: this.id,
                    reliable,
                    p2p: this.p2p
                });
                break;

            default:
                console.error(`Unrecognized command ${cmd.toString(16)}`);
                this.close();
        }
    }

    /**
     * Called when a message is received on the unreliable socket.
     */
    onUnreliableMessage(ev: MessageEvent) {
        const msg = new Buffer(ev.data);
        if (msg.length < 4)
            return this.close();
        const cmd = msg.readUInt16LE(2);

        // Only data is allowed on the unreliable socket
        if (cmd !== prot.ids.data)
            return this.close();

        this.onMessage(ev, false);
    }

    /**
     * Handler for RTC negotiation with the client.
     */
    async rtcMessage(msg: Buffer) {
        const p = prot.parts.rtc;
        let data: any = null;
        try {
            data = JSON.parse(msg.toString("utf8", p.data));
        } catch (ex) {}
        if (typeof data !== "object" || data === null)
            return this.close();

        const peer: RTCPeerConnection = this.unreliableP;
        if (!peer)
            return;

        // Perfect negotiation pattern
        try {
            if (data.description) {
                const ignoreOffer = this.unreliableIgnoreOffer =
                    (data.description.type === "offer") &&
                    (this.unreliableMakingOffer ||
                     peer.signalingState !== "stable");

                if (ignoreOffer)
                    return;

                await peer.setRemoteDescription(data.description);
                if (data.description.type === "offer") {
                    await peer.setLocalDescription(
                        await peer.createAnswer());

                    const info = Buffer.from(JSON.stringify(
                        {description: peer.localDescription}
                    ));
                    const msg = net.createPacket(
                        p.length + info.length,
                        65535, prot.ids.rtc,
                        [[p.data, info]]
                    );
                    this.socket.send(msg);
                }

            } else if (data.candidate) {
                try {
                    await peer.addIceCandidate(data.candidate);
                } catch (ex) {
                    if (!this.unreliableIgnoreOffer)
                        throw ex;
                }

            }

        } catch (ex) {
            //console.error(ex);

        }
    }

    /**
     * The unreliable connection for this user.
     */
    unreliable: RTCDataChannel;

    /**
     * The associated RTC connection.
     */
    unreliableP: RTCPeerConnection;

    /**
     * Perfect negotiation: Are we currently making an offer?
     */
    unreliableMakingOffer: boolean;

    /**
     * Perfect negotiation: Are we currently ignoring offers?
     */
    unreliableIgnoreOffer: boolean;

    /**
     * This user's name (NOT USED YET)
     */
    name: string;

    /**
     * Formats this user can receive, as a set.
     */
    receiveSet: Set<string>;

    /**
     * The peers to which this client has P2P connections.
     */
    p2p: Set<number>;

    /**
     * The ID of the stream this user is currently transmitting, or -1 for no
     * stream.
     */
    streamId: number;

    /**
     * The stream metadata for this user.
     */
    stream: any[];
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
            const msg = net.createPacket(4, idx, prot.ids.ack, []);
            socket.send(msg.buffer);
        }

        // Finish resolving the formats
        this._resolveFormats();

        // Tell everyone else about them
        {
            const p = prot.parts.peer;
            const info = Buffer.from('{"name":""}');
            const msg = net.createPacket(
                p.length + info.length,
                idx, prot.ids.peer,
                [
                    [p.status, 1, 1],
                    [p.data, info]
                ]
            );
            this.relay(msg, {except: idx});
        }

        // And tell them about everyone else
        for (let oidx = 0; oidx < this._members.length; oidx++) {
            if (idx === oidx)
                continue;

            const other = this._members[oidx];

            if (!other)
                continue;

            {
                const p = prot.parts.peer;
                const info = Buffer.from('{"name":""}');
                const msg = net.createPacket(
                    p.length + info.length,
                    oidx, prot.ids.peer,
                    [
                        [p.status, 1, 1],
                        [p.data, info]
                    ]
                );
                socket.send(msg);
            }

            // And their stream
            if (!other.stream)
                continue;

            try {
                const p = prot.parts.stream;
                const info = Buffer.from(JSON.stringify(
                    other.stream));
                const msg = net.createPacket(
                    p.length + info.length,
                    oidx, prot.ids.stream,
                    [
                        [p.id, 1, other.streamId],
                        [p.data, info]
                    ]
                );
                socket.send(msg);
            } catch (ex) {}
        }
    }

    /**
     * Remove a member from this room.
     */
    removeMember(member: Member) {
        const idx = this._members.indexOf(member);
        if (idx < 0)
            return;
        this._members[idx] = null;

        // Tell everybody else that they're gone
        {
            const p = prot.parts.peer;
            const info = Buffer.from("{}");
            const msg = net.createPacket(
                p.length + info.length,
                idx, prot.ids.peer,
                [
                    [p.status, 1, 0],
                    [p.data, info]
                ]
            );

            this.relay(msg);
        }

        // Forget any P2P info targetting them
        for (const member of this._members) {
            if (member)
                member.p2p.delete(idx);
        }
    }

    /**
     * Send data to a given member.
     */
    send(peer: number, msg: Buffer) {
        const member = this._members[peer];
        if (!member)
            return false;
        member.socket.send(msg);
        return true;
    }

    /**
     * Relay data to all members in the room.
     */
    relay(msg: Buffer, opts: {
        except?: number,
        reliable?: boolean,
        p2p?: Set<number>
    } = {}) {
        const except = (typeof opts.except === "number") ? opts.except : -1;
        const reliable =
            (typeof opts.reliable === "boolean") ? opts.reliable : true;
        const p2p = opts.p2p;

        for (let i = 0; i < this._members.length; i++) {
            if (i === except)
                continue;
            const member = this._members[i];
            if (!member)
                continue;

            if (p2p && p2p.has(i))
                continue;

            if (!reliable && member.unreliable)
                member.unreliable.send(msg);
            else
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
                const buf = net.createPacket(
                    p.length + formats.length,
                    65535, prot.ids.formats,
                    [[p.data, formats]]
                );
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
