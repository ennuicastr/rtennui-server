# RTEnnui Server

This is the server for [RTEnnui](https://github.com/ennuicastr/rtennui).


## Status

You can find a more complete description of the status of RTEnnui in the client
repository.


## Usage

The API is documented with TypeDoc at
https://ennuicastr.github.io/doc/rtennui-server/ . This is an ECMAScript
module, and so should be `import`-ed. Use
`import("rtennui-server/src/main.js")` until Node adds proper directory
importing.

You need to provide your own WebSocket server. A demonstration of a simple
RTEnnui server (and associated client) is in `samples/basic-server`.
