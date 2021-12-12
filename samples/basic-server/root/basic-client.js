(async function() {
    const ac = new AudioContext();
    if (ac.state !== "running") {
        const btn = document.createElement("button");
        btn.innerText = "Join";
        document.body.appendChild(btn);
        await new Promise(res => btn.onclick = res);
        document.body.removeChild(btn);
        await ac.resume();
    }

    const ms = await navigator.mediaDevices.getUserMedia({video: true, audio: true});

    const url = new URL(document.location.href);
    const room = url.searchParams.get("room") || "RTEnnui";

    await LibAVWebCodecs.load();
    await RTEnnui.load();

    const conn = new RTEnnui.Connection(ac);

    conn.on("track-started-video", ev => {
        Object.assign(ev.element.style, {
            width: "640px",
            height: "360px"
        });
        document.body.appendChild(ev.element);
    });

    conn.on("track-ended-video", ev => {
        try {
            ev.element.parentElement.removeChild(ev.element);
        } catch (ex) {}
    });

    conn.on("track-started-audio", ev => {
        ev.node.connect(ac.destination);
    });

    conn.on("track-ended-audio", ev => {
        ev.node.disconnect(ac.destination);
    });

    conn.on("*", ev => {
        console.log(ev.event + ": " + ev.arg);
    });

    await conn.connect("/ws", {room});

    const audio = await RTEnnui.createAudioCapture(ac, ms);
    conn.addAudioTrack(audio);

    if (ms.getVideoTracks().length) {
        const video = await RTEnnui.createVideoCapture(ms);
        conn.addVideoTrack(video);
    }
})();
