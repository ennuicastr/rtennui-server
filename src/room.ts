// SPDX-License-Identifier: ISC
/*
 * Copyright (c) 2021-2023 Yahweasel
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

import rte from "rtennui/rtennui.min.js";
const prot = rte.protocol;
import wrtc from "wrtc";

/**
 * A room container (really just main).
 */
export interface RoomContainer {
    roomEmpty(r: Room): void;
}

/**
 * An individual in a room. Only used internally.
 * @private
 */
class Member {
    constructor(
        /**
         * The room this member is in.
         * @private
         */
        public room: Room,

        /**
         * The ID of this member.
         * @private
         */
        public id: number,

        /**
         * The public info for this member, as a buffer.
         * @private
         */
        public info: Buffer,

        /**
         * The reliable socket for this member.
         * @private
         */
        public socket: WebSocket,

        /**
         * Formats this user can transmit.
         * @private
         */
        public transmit: string[],

        /**
         * Formats this user can receive.
         * @private
         */
        public receive: string[]
    ) {
        this.receiveSet = new Set(receive);
        this.streamId = -1;
        this.stream = null;
        this.unreliable = null;
        this.unreliableMakingOffer = false;
        this.unreliableIgnoreOffer = false;
        this.reliabilityProber = null;
        this.closed = false;

        // Prepare for disconnection
        socket.addEventListener("close", () => this.close());
        socket.addEventListener("error", () => this.close());

        // Open an unreliable connection
        const peer = this.unreliableP =
            <RTCPeerConnection> new wrtc.RTCPeerConnection({
                iceServers: util.iceServers
            });

        socket.onmessage = ev => this.onMessage(ev);

        peer.onnegotiationneeded = async ev => {
            if (this.closed) {
                peer.close();
                return;
            }

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
            if (this.closed) {
                peer.close();
                return;
            }

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
            if (this.closed) {
                peer.close();
                return;
            }

            const chan = ev.channel;
            chan.binaryType = "arraybuffer";

            chan.addEventListener("close", () => {
                if (this.unreliable === chan) {
                    this.unreliable = null;
                    this.reliabilityProber.stop();
                    this.reliabilityProber = null;
                }
            }, {once: true});

            chan.onmessage = ev => this.onUnreliableMessage(ev);

            this.unreliable = chan;
            this.reliability = true;
            this.reliabilityProber = new rte.ReliabilityProber(
                chan, true, reliability => this.onReliability(reliability));
        };
    }

    /**
     * Disconnect this member.
     * @private
     */
    close() {
        if (this.closed)
            return;
        this.closed = true;
        if (this.socket)
            this.socket.close();
        if (this.unreliable)
            this.unreliable.close();
        if (this.unreliableP)
            this.unreliableP.close();
        this.room.removeMember(this);

        this.socket = null;
        this.unreliable = null;
    }

    /**
     * Called when a message is received. Called directly for reliable,
     * indirectly for unreliable.
     * @private
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
                break; // No longer needed

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
                    except: this.id
                });
                break;
            }

            case prot.ids.info:
            case prot.ids.ctcp:
                // FIXME: Some validation
                msg.writeUInt16LE(this.id, 0);
                this.room.send(peer, msg);
                break;

            case prot.ids.relay:
            {
                // Extract the actual data
                const p = prot.parts.relay;
                const targetCt = msg.readUInt8(p.data);
                const dataMsg = msg.slice(p.data + 1 + targetCt);
                if (dataMsg.length < 4)
                    return this.close();
                const dataCmd = dataMsg.readUInt16LE(2);
                if (dataCmd !== prot.ids.data && dataCmd !== prot.ids.ack)
                    return this.close();
                dataMsg.writeUInt16LE(this.id, 0);
                this.room.relay(dataMsg, {
                    except: this.id,
                    reliable,
                    targetsFrom: msg
                });
                break;
            }

            default:
                console.error(`Unrecognized command ${cmd.toString(16)}`);
                this.close();
        }
    }

    /**
     * Called when a message is received on the unreliable socket.
     * @private
     */
    onUnreliableMessage(ev: MessageEvent) {
        const msg = new Buffer(ev.data);
        if (msg.length < 4)
            return this.close();
        const cmd = msg.readUInt16LE(2);

        switch (cmd) {
            case prot.ids.rping:
                // Pong on the same channel (FIXME: flooding)
                if (msg.length < 8)
                    return this.close();
                msg.writeUInt16LE(prot.ids.rpong, 2);
                this.unreliable.send(Buffer.from(msg));
                break;

            case prot.ids.rpong:
                // This is their response to our ping, handled elsewhere
                break;

            case prot.ids.relay:
                // Can be sent unreliably or reliably
                this.onMessage(ev, false);
                break;

            default:
                // No other types allowed
                return this.close();
        }
    }

    /**
     * Called when the reliability prober updates the reliability status of
     * the unreliable channel.
     * @private
     */
    onReliability(reliability: rte.Reliability) {
        this.reliability = (reliability === rte.Reliability.RELIABLE);
    }

    /**
     * Handler for RTC negotiation with the client.
     * @private
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
     * @private
     */
    unreliable: RTCDataChannel;

    /**
     * The associated RTC connection.
     * @private
     */
    unreliableP: RTCPeerConnection;

    /**
     * Perfect negotiation: Are we currently making an offer?
     * @private
     */
    unreliableMakingOffer: boolean;

    /**
     * Perfect negotiation: Are we currently ignoring offers?
     * @private
     */
    unreliableIgnoreOffer: boolean;

    /**
     * Prober for whether the unreliable connection is actually reliable.
     * @private
     */
    reliabilityProber: rte.ReliabilityProber;

    /**
     * Set to true of the unreliable connection is actually reliable.
     * @private
     */
    reliability: boolean;

    /**
     * Formats this user can receive, as a set.
     * @private
     */
    receiveSet: Set<string>;

    /**
     * The ID of the stream this user is currently transmitting, or -1 for no
     * stream.
     * @private
     */
    streamId: number;

    /**
     * The stream metadata for this user.
     * @private
     */
    stream: any[];

    /**
     * Has this user's connection been closed?
     * @private
     */
    closed: boolean;
}

/**
 * A single room, with all its members.
 */
export class Room {
    constructor(
        /**
         * ID for this room. Only really used by surrounding context.
         */
        public id: string,

        /**
         * Container for this room. Who the room reports to when it's empty.
         */
        public container: RoomContainer
    ) {
        this._members = [];
    }

    /**
     * Accept a new connection into this room.
     * @param socket  The WebSocket.
     * @param login  Login information. Credentials have already been checked.
     * @param info  Public information for this user.
     */
    accept(socket: WebSocket, login: any, info: any) {
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

        // Make the member
        const member = this._members[idx] =
            new Member(this, idx, Buffer.from(JSON.stringify(info)), socket, t,
                r);

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
        this._resolveFormats({forceSendTo: [member]});

        // Tell everyone else about them
        {
            const p = prot.parts.peer;
            const msg = net.createPacket(
                p.length + member.info.length,
                idx, prot.ids.peer,
                [
                    [p.status, 1, 1],
                    [p.data, member.info]
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
                const msg = net.createPacket(
                    p.length + other.info.length,
                    oidx, prot.ids.peer,
                    [
                        [p.status, 1, 1],
                        [p.data, other.info]
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
     * @param member  Member to remove.
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

        /* Report the current number of members so the main process can delete
         * this room */
        let ct = 0;
        for (const member of this._members) {
            if (member) {
                ct++;
                break;
            }
        }
        if (!ct)
            this.container.roomEmpty(this);
    }

    /**
     * Send data to a given member.
     * @param peer  Member to send to, by number.
     * @param msg  Message to send.
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
     * @param msg  Message to send.
     * @param opts  Send options.
     */
    relay(msg: Buffer, opts: {
        except?: number,
        reliable?: boolean,
        targetsFrom?: Buffer // relay message
    } = {}) {
        const except = (typeof opts.except === "number") ? opts.except : -1;
        const reliable =
            (typeof opts.reliable === "boolean") ? opts.reliable : true;
        const targetsFrom = opts.targetsFrom;
        let targetCt = 0, targetByte = 0;
        if (targetsFrom) {
            targetCt = targetsFrom.readUInt8(prot.parts.relay.data);
            targetByte = targetsFrom.readUInt8(prot.parts.relay.data + 1);
        }

        let ihi = 0, ilo = -1;
        for (let i = 0; i < this._members.length; i++) {
            // Advance to the next target byte
            if (targetsFrom) {
                ilo++;
                if (ilo >= 8) {
                    ihi++;
                    ilo = 0;
                    if (ihi >= targetCt) {
                        targetByte = 0;
                    } else {
                        targetByte = targetsFrom.readUInt8(
                            prot.parts.relay.data + 1 + ihi
                        );
                    }
                }

                // Check if it's set
                if (!(targetByte & (1<<ilo)))
                    continue;
            }

            if (i === except)
                continue;
            const member = this._members[i];
            if (!member)
                continue;

            if (!reliable && member.unreliable && member.reliability) {
                member.unreliable.send(msg);
            } else if (!reliable) {
                // No unreliable connection, but at least don't buffer
                if (member.socket.bufferedAmount < 8192)
                    member.socket.send(msg);
            } else {
                member.socket.send(msg);
            }
        }
    }

    /**
     * Figure out what formats are supported. Returns true if there is at least
     * one video format and at least one audio format supported for both
     * transmission and receipt by all clients.
     * @param opts  Options. In particular, whether to do a dry run.
     */
    private _resolveFormats(opts: {
        dryRun?: boolean,
        forceSendTo?: Member[]
    } = {}) {
        let r: string[] = [];
        let first = true;

        // Find the formats that everyone can receive
        for (const member of this._members) {
            if (!member)
                continue;

            if (first) {
                // Start with them
                r = member.receive.slice(0);
                first = false;
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

            //if (!v || !a) {
            if (!a) {
                success = false;
                break;
            }
        }

        // Update
        if (!opts.dryRun) {
            let sendTo: Member[] = this._members;

            // Determine if the formats have actually changed
            if (JSON.stringify(this._formats) === JSON.stringify(r))
                sendTo = [];
            else
                this._formats = r;

            // But forcibly send it to the given targets if asked
            if (!sendTo.length && opts.forceSendTo)
                sendTo = opts.forceSendTo;

            if (sendTo.length) {
                // Send them to the targets (usually everyone)
                const p = prot.parts.formats;
                const formats = Buffer.from(JSON.stringify(r));
                const buf = net.createPacket(
                    p.length + formats.length,
                    65535, prot.ids.formats,
                    [[p.data, formats]]
                );
                for (const member of sendTo) {
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
