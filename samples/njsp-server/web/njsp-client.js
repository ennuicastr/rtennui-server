(async function() {
    const ac = new AudioContext();
    const btn = document.createElement("button");
    btn.innerText = "Join";
    document.body.appendChild(btn);
    await new Promise(res => btn.onclick = res);
    document.body.removeChild(btn);

    if (ac.state !== "running")
        await ac.resume();

    const ms = await navigator.mediaDevices.getUserMedia({audio: true});

    const url = new URL(document.location.href);
    const room = url.searchParams.get("room") || "RTEnnui";

    await LibAVWebCodecs.load();
    await RTEnnui.load();

    const conn = new RTEnnui.Connection(ac);

    conn.on("track-started-audio", ev => {
        ev.node.connect(ac.destination);
    });

    conn.on("track-ended-audio", ev => {
        ev.node.disconnect(ac.destination);
    });

    conn.on("*", ev => {
        let str;
        try {
            str = JSON.stringify(ev);
        } catch (ex) {
            str = "" + ev;
        }
        console.log(ev.event + ": " + str);
    });

    await conn.connect("/rtennui/ws", {room});

    const audio = await RTEnnui.createAudioCapture(ac, ms);
    conn.addAudioTrack(audio, {frameSize: 5000});
})();
