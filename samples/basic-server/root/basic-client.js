(async function() {
    const ac = new AudioContext();

    const nm = document.createElement("input");
    nm.value = "Anonymous";
    document.body.appendChild(nm);

    const btn = document.createElement("button");
    btn.innerText = "Join";
    document.body.appendChild(btn);

    await new Promise(res => btn.onclick = res);
    document.body.removeChild(nm);
    document.body.removeChild(btn);

    if (ac.state !== "running")
        await ac.resume();

    let ms;
    try {
        ms = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
    } catch (ex) {
        ms = await navigator.mediaDevices.getUserMedia({audio: true});
    }

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
        ev.playback.unsharedNode().connect(ac.destination);
    });

    conn.on("track-ended-audio", ev => {
        ev.playback.unsharedNode().disconnect(ac.destination);
    });

    conn.on("*", ev => {
        let str;
        try {
            str = JSON.stringify(ev.arg);
        } catch (ex) {
            str = "" + ev.arg;
        }
        console.log(ev.event + ": " + str);
    });

    await conn.connect("/ws", {
        room,
        info: {name: nm.value}
    });

    const audio = await RTEnnui.createAudioCapture(ac, ms);
    conn.addAudioTrack(audio);

    if (ms.getVideoTracks().length) {
        const video = await RTEnnui.createVideoCapture(ms);
        conn.addVideoTrack(video);
    }
})();
