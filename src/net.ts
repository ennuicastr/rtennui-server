// SPDX-License-Identifier: ISC
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

/**
 * A description of a number entry.
 */
export type NumberDescr = [number, number, number];

/**
 * A description of a buffer entry.
 */
export type BufferDescr = [number, Buffer];

/**
 * A description is either.
 */
export type Descr = NumberDescr | BufferDescr;

/**
 * Create a Buffer based on a description.
 */
export function createPacket(
    len: number, peer: number, cmd: number, descr: Descr[]
) {
    const ret = Buffer.alloc(len);
    ret.writeUInt16LE(peer, 0);
    ret.writeUInt16LE(cmd, 2);
    for (const d of descr) {
        if (typeof d[1] === "number") {
            switch (d[1]) {
                case 1:
                    ret.writeUInt8(d[2], d[0]);
                    break;

                case 2:
                    ret.writeUInt16LE(d[2], d[0]);
                    break;

                case 4:
                    ret.writeUInt32LE(d[2], d[0]);
                    break;

                default:
                    throw new Error("Invalid description");
            }

        } else {
            (<Buffer> d[1]).copy(ret, d[0]);

        }
    }

    return ret;
}
