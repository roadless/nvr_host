import { LoaderCircle, VideoOff } from "lucide-react";
import type { PlaybackMode } from "../../shared/types";

interface Props {
  animationKey: string;
  cameraName: string;
  streamName: string;
  go2rtcPort: string;
  playbackMode: PlaybackMode;
  status: "empty" | "loading" | "waiting" | "live";
}

function buildPlayerUrl(streamName: string, go2rtcPort: string, playbackMode: PlaybackMode) {
  const baseUrl = `http://${window.location.hostname}:${go2rtcPort}`;
  const src = encodeURIComponent(streamName);

  if (playbackMode === "mse") {
    return `${baseUrl}/stream.html?src=${src}&mode=mse`;
  }

  if (playbackMode === "auto") {
    return `${baseUrl}/stream.html?src=${src}&mode=webrtc,webrtc/tcp,mse`;
  }

  return `${baseUrl}/webrtc.html?src=${src}&media=video`;
}

export function StreamTile({ animationKey, cameraName, streamName, go2rtcPort, playbackMode, status }: Props) {
  const playerUrl = status === "live" && streamName ? buildPlayerUrl(streamName, go2rtcPort, playbackMode) : "";
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
