import { LoaderCircle, VideoOff } from "lucide-react";

interface Props {
  animationKey: string;
  cameraName: string;
  streamName: string;
  go2rtcPort: string;
  status: "empty" | "loading" | "waiting" | "live";
}

export function WebRtcTile({ animationKey, cameraName, streamName, go2rtcPort, status }: Props) {
  const playerUrl = status === "live" && streamName
    ? `http://${window.location.hostname}:${go2rtcPort}/webrtc.html?src=${encodeURIComponent(streamName)}&media=video`
    : "";
  const showStatus = status !== "live";

  return (
    <div className="video-tile">
      <div className="tile-media" key={animationKey}>
        {playerUrl && <iframe allow="autoplay; fullscreen" scrolling="no" src={playerUrl} title={cameraName} />}
      </div>
      <div className="tile-label">{cameraName}</div>
      {showStatus && (
        <div className={`tile-status ${status}`}>
          {status === "loading" ? <LoaderCircle className="spin" size={24} /> : <VideoOff size={24} />}
          <span>{status === "loading" ? "Loading" : status === "waiting" ? "Waiting" : "Empty"}</span>
        </div>
      )}
    </div>
  );
}
