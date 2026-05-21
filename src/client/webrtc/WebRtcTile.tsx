import { VideoOff } from "lucide-react";

interface Props {
  cameraName: string;
  streamName: string;
  go2rtcPort: string;
}

export function WebRtcTile({ cameraName, streamName, go2rtcPort }: Props) {
  const playerUrl = streamName
    ? `http://${window.location.hostname}:${go2rtcPort}/stream.html?src=${encodeURIComponent(streamName)}&mode=webrtc&media=video`
    : "";

  return (
    <div className="video-tile">
      {playerUrl && <iframe allow="autoplay; fullscreen" src={playerUrl} title={cameraName} />}
      <div className="tile-label">{cameraName}</div>
      {!streamName && (
        <div className="tile-status">
          <VideoOff size={24} />
          <span>Bos</span>
        </div>
      )}
    </div>
  );
}
