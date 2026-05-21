import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, VideoOff } from "lucide-react";

interface Props {
  cameraName: string;
  streamName: string;
  go2rtcPort: string;
}

type Status = "idle" | "connecting" | "playing" | "error";

export function WebRtcTile({ cameraName, streamName, go2rtcPort }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const retryTimer = useRef<number | null>(null);
  const [status, setStatus] = useState<Status>(streamName ? "connecting" : "idle");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!streamName) {
      setStatus("idle");
      return;
    }

    let closed = false;
    const pc = new RTCPeerConnection();
    const ws = new WebSocket(`ws://${window.location.hostname}:${go2rtcPort}/api/ws?src=${encodeURIComponent(streamName)}`);

    setStatus("connecting");
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.ontrack = (event) => {
      if (!videoRef.current) return;
      const [stream] = event.streams;
      videoRef.current.srcObject = stream;
      setStatus("playing");
    };

    pc.onicecandidate = (event) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: "webrtc/candidate",
          value: event.candidate?.candidate ?? ""
        })
      );
    };

    pc.onconnectionstatechange = () => {
      if (closed) return;
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setStatus("error");
      }
    };

    ws.onopen = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(
          JSON.stringify({
            type: "webrtc/offer",
            value: offer.sdp
          })
        );
      } catch {
        setStatus("error");
      }
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type: string; value?: string };
        if (message.type === "webrtc/answer" && message.value) {
          await pc.setRemoteDescription({ type: "answer", sdp: message.value });
        }
        if (message.type === "webrtc/candidate" && message.value) {
          await pc.addIceCandidate({ candidate: message.value });
        }
      } catch {
        setStatus("error");
      }
    };

    ws.onerror = () => setStatus("error");
    ws.onclose = () => {
      if (!closed && status !== "playing") setStatus("error");
    };

    return () => {
      closed = true;
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      ws.close();
      pc.close();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [go2rtcPort, retryKey, streamName]);

  useEffect(() => {
    if (status !== "error" || !streamName) return;
    retryTimer.current = window.setTimeout(() => setRetryKey((key) => key + 1), 5000);
    return () => {
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, [status, streamName]);

  return (
    <div className="video-tile">
      <video ref={videoRef} autoPlay muted playsInline />
      <div className="tile-label">{cameraName}</div>
      {status === "idle" && (
        <div className="tile-status">
          <VideoOff size={24} />
          <span>Boş</span>
        </div>
      )}
      {status === "connecting" && (
        <div className="tile-status">
          <Loader2 className="spin" size={24} />
          <span>Bağlanıyor</span>
        </div>
      )}
      {status === "error" && (
        <div className="tile-status error">
          <AlertTriangle size={24} />
          <span>Yayın yok, tekrar deneniyor</span>
        </div>
      )}
    </div>
  );
}
