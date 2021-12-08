/**
 * Standard ICE servers. Note that our WebSocket server will relay data if we
 * can't get a direct connection, so we have no use for TURN.
 */
export const iceServers = [{urls: "stun:stun.l.google.com:19302"}];
