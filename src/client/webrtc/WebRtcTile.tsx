import { VideoOff } from "lucide-react";

interface Props {
  animationKey: string;
  cameraName: string;
  streamName: string;
  go2rtcPort: string;
}

export function WebRtcTile({ animationKey, cameraName, streamName, go2rtcPort }: Props) {
  const playerUrl = streamName
    ? `http://${window.location.hostname}:${go2rtcPort}/webrtc.html?src=${encodeURIComponent(streamName)}&media=video`
    : "";

  return (
    <div className="video-tile">
      <div className="tile-media" key={animationKey}>
        {playerUrl && <iframe allow="autoplay; fullscreen" scrolling="no" src={playerUrl} title={cameraName} />}
      </div>
      <div className="tile-label">{cameraName}</div>
      {!streamName && (
        <div className="tile-status">
          <VideoOff size={24} />
          <span>Empty</span>
        </div>
      )}
    </div>
  );
}
