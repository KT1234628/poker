'use client';

import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';

export function VideoTile({ identity, fallbackInitials }: { identity: string; fallbackInitials: string }) {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const tile = tracks.find(t => t.participant.identity === identity);
  if (!tile) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900 text-2xl font-bold">
        {fallbackInitials}
      </div>
    );
  }
  return <VideoTrack trackRef={tile} className="h-full w-full object-cover" />;
}
