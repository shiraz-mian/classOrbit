import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Video, LoaderCircle } from 'lucide-react';
import { api } from '../services/api';
export default function VideoPlayer({ lesson }) {
  const savedPosition = useRef(null);
  const ref = useRef(),
    [playback, setPlayback] = useState(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setPlayback(null);
    setError('');
    api('/lessons/' + lesson.id + '/playback')
      .then((p) => {
        if (active) setPlayback(p);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [lesson.id, lesson.videoStatus, lesson.videoPath]);
  useEffect(() => {
    if (!['QUEUED', 'PROCESSING'].includes(playback?.status)) return;
    let active = true;
    const timer = setInterval(() => {
      api('/lessons/' + lesson.id + '/playback')
        .then((result) => {
          if (active) {
            setPlayback(result);
            setError('');
          }
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    }, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [lesson.id, playback?.status]);
  async function refreshVideo() {
    try {
      setPlayback(await api('/lessons/' + lesson.id + '/playback'));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (!playback?.expiresAt) return;
    let active = true,
      timer,
      failures = 0;
    async function renew() {
      try {
        const fresh = await api('/lessons/' + lesson.id + '/playback');
        if (active) {
          setPlayback(fresh);
          setError('');
        }
      } catch (e) {
        if (!active) return;
        setError(
          'Video access could not be refreshed. Check your connection and try Refresh video.',
        );
        if (++failures < 3) timer = setTimeout(renew, 5000);
      }
    }
    timer = setTimeout(
      renew,
      Math.max(1000, new Date(playback.expiresAt).getTime() - Date.now() - 30000),
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [lesson.id, playback?.expiresAt]);
  useEffect(() => {
    if (!playback?.url || !ref.current) return;
    const video = ref.current;
    let hls;
    const restore = () => {
      const previous = savedPosition.current;
      if (previous?.lessonId !== lesson.id || !previous.time) return;
      video.currentTime = Number.isFinite(video.duration)
        ? Math.min(previous.time, Math.max(0, video.duration - 0.1))
        : previous.time;
      if (previous.playing) video.play().catch(() => {});
    };
    video.addEventListener('loadedmetadata', restore, { once: true });
    if (playback.url.includes('.m3u8') && Hls.isSupported()) {
      hls = new Hls({
        xhrSetup: (xhr, url) => {
          xhr.withCredentials =
            new URL(url, location.href).origin === location.origin ||
            playback.credentials === 'include';
        },
      });
      hls.loadSource(playback.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal)
          setError('Video could not be loaded. Check your connection and try Refresh video.');
      });
    } else video.src = playback.url;
    return () => {
      savedPosition.current = {
        lessonId: lesson.id,
        time: video.currentTime,
        playing: !video.paused,
      };
      video.removeEventListener('loadedmetadata', restore);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [lesson.id, playback?.url, playback?.credentials]);
  return (
    <div className="video-wrap">
      {playback?.url ? (
        <>
          <video
            ref={ref}
            crossOrigin={
              playback?.status === 'READY'
                ? playback.credentials === 'omit'
                  ? 'anonymous'
                  : 'use-credentials'
                : undefined
            }
            controls
            playsInline
            onError={() => setError('Video could not be loaded. Check your connection.')}
            aria-label={lesson.title}
          />
          {playback.status === 'SAMPLE' && (
            <p className="sample-caption">
              Player demonstration: Big Buck Bunny © 2008 Blender Foundation, CC BY 3.0. This sample
              is unrelated to the lesson.{' '}
              <a href="https://peach.blender.org/" target="_blank" rel="noreferrer">
                Source & attribution
              </a>
            </p>
          )}
        </>
      ) : (
        <div className="video-placeholder">
          <Video size={36} />
          <h3>
            {!playback && !error
              ? 'Preparing your lesson…'
              : playback?.status === 'PROCESSING' || playback?.status === 'QUEUED'
                ? 'Video is processing'
                : playback?.status === 'FAILED'
                  ? 'Video conversion needs attention'
                  : 'Make room for a new idea.'}
          </h3>
          <p>
            {error ||
              'The written lesson is ready below. Your instructor can add a video in the Studio.'}
          </p>
        </div>
      )}
      {error && playback?.url && (
        <p className="form-error" role="alert">
          {error}{' '}
          <button className="text-link" onClick={refreshVideo}>
            Refresh video
          </button>
        </p>
      )}
    </div>
  );
}
