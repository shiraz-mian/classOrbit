import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Video,
  VideoOff,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Send,
  Users,
  Radio,
  MessageSquare,
  AlertCircle,
} from 'lucide-react';
import { api, dateTime } from '../services/api';
import { Button, Loader, Avatar } from '../components/ui';
import { useLiveRoom } from '../hooks/useLiveRoom';
function VideoTile({ stream, name, muted = false, state }) {
  const ref = useRef();
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  return (
    <div className="video-tile">
      {stream ? (
        <video ref={ref} autoPlay playsInline muted={muted} />
      ) : (
        <Avatar name={name} size="large" />
      )}
      <span className="video-name">
        {name}
        {muted ? ' (you)' : ''}
      </span>
      {state && state !== 'connected' && <span className="peer-status">{state}</span>}
    </div>
  );
}
export default function LiveRoom({ id, data, navigate, notify, onLogin }) {
  const [detail, setDetail] = useState(null),
    [error, setError] = useState(''),
    [stream, setStream] = useState(null),
    [joined, setJoined] = useState(false),
    [busy, setBusy] = useState(false),
    [mic, setMic] = useState(true),
    [camera, setCamera] = useState(true),
    [text, setText] = useState(''),
    [sharing, setSharing] = useState(false),
    [display, setDisplay] = useState(null);
  const streamRef = useRef(null),
    shareRef = useRef(null),
    chatEnd = useRef();
  const { peers, messages, status, send, replaceVideo } = useLiveRoom({
    id,
    enabled: joined,
    stream,
    iceServers: detail?.iceServers || [],
    onError: (m) => notify(m, 'error'),
  });
  useEffect(() => {
    let active = true;
    setDetail(null);
    setError('');
    api('/live-classes/' + id + '/config')
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, data.user?.id]);
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      shareRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);
  async function join(withMedia = true) {
    setBusy(true);
    try {
      let local = null;
      if (withMedia) {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error(
            'Camera and microphone need HTTPS or localhost. You can still join with chat.',
          );
        local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamRef.current = local;
        setStream(local);
      }
      setJoined(true);
    } catch (e) {
      notify(
        'Camera or microphone unavailable: ' + e.message + '. You can join without them.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }
  function leave() {
    setJoined(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    shareRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setDisplay(null);
    setSharing(false);
    navigate('live');
  }
  function toggle(kind) {
    const tracks = kind === 'audio' ? stream?.getAudioTracks() : stream?.getVideoTracks();
    if (!tracks?.length) return;
    const enabled = !tracks[0].enabled;
    tracks.forEach((t) => (t.enabled = enabled));
    if (kind === 'audio') setMic(enabled);
    else setCamera(enabled);
  }
  async function stopShare() {
    shareRef.current?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    shareRef.current = null;
    setDisplay(null);
    setSharing(false);
    const track = stream?.getVideoTracks()[0];
    if (track) await replaceVideo(track);
  }
  async function share() {
    if (sharing) {
      await stopShare();
      return;
    }
    try {
      const capture = await navigator.mediaDevices.getDisplayMedia({ video: true });
      shareRef.current = capture;
      const track = capture.getVideoTracks()[0];
      await replaceVideo(track);
      track.onended = stopShare;
      setDisplay(capture);
      setSharing(true);
    } catch (e) {
      if (e.name !== 'NotAllowedError') notify(e.message, 'error');
    }
  }
  async function chat(e) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await send(text);
      setText('');
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  if (error)
    return (
      <div className="panel room-access">
        <Radio size={35} />
        <h2>{error}</h2>
        <p>Live classrooms are for enrolled learners and their instructors.</p>
        <div className="button-row">
          <Button secondary onClick={() => navigate('live')}>
            Back to classes
          </Button>
          {!data.user && <Button onClick={onLogin}>Sign in</Button>}
        </div>
      </div>
    );
  if (!detail) return <Loader />;
  const { live } = detail;
  const allMessages = [
    ...detail.messages,
    ...messages.filter((m) => !detail.messages.some((v) => v.id === m.id)),
  ];
  return (
    <>
      <button className="back-link" onClick={joined ? leave : () => navigate('live')}>
        <ArrowLeft size={16} />
        Back to live classes
      </button>
      <div className="room-heading">
        <div>
          <span className="eyebrow">YOUR LIVE CLASSROOM</span>
          <h1>{live.title}</h1>
          <p>
            {dateTime(live.startsAt)} · {live.duration} min · Up to 8 participants
          </p>
        </div>
        {joined && (
          <span className={'room-status ' + (status === 'connected' ? 'connected' : '')}>
            <i />
            {status}
          </span>
        )}
      </div>
      {!joined ? (
        <div className="room-lobby">
          <div className="lobby-art">
            <div className="lobby-orbit" />
            <Radio size={64} />
            <span>Good conversations start here.</span>
          </div>
          <div className="lobby-copy">
            <span className="eyebrow">COME AS YOU ARE</span>
            <h2>Ready to connect?</h2>
            <p>
              Allow your camera and microphone to join the conversation. You can also join with chat
              and listen to the room.
            </p>
            <p className="muted">
              The room opens for rehearsals before the scheduled start. No recording is made by
              ClassOrbit.
            </p>
            <Button disabled={busy} onClick={() => join(true)}>
              <Video size={18} />
              {busy ? 'Opening your devices…' : 'Join with camera & mic'}
            </Button>
            <Button secondary disabled={busy} onClick={() => join(false)}>
              Join without camera & mic
              <ArrowLeft className="rotate-arrow" size={16} />
            </Button>
          </div>
        </div>
      ) : (
        <div className="room-workspace">
          <div className="room-stage">
            <div className="video-grid">
              <VideoTile stream={display || stream} name={data.user.name} muted />
              {peers.map((p) => (
                <VideoTile
                  key={p.id}
                  stream={p.stream}
                  name={p.user?.name || 'Participant'}
                  state={p.state}
                />
              ))}
            </div>
            {!peers.length && (
              <div className="room-waiting">
                <Users size={18} />
                You’re the first here. Invite another enrolled learner to this classroom.
              </div>
            )}
            <div className="room-controls">
              <span>
                <Users size={16} />
                {peers.length + 1} in the room
              </span>
              <div>
                <button
                  className={'room-control ' + (!mic ? 'off' : '')}
                  disabled={!stream}
                  onClick={() => toggle('audio')}
                  aria-label={mic ? 'Mute microphone' : 'Unmute microphone'}
                >
                  {mic ? <Mic size={20} /> : <MicOff size={20} />}
                </button>
                <button
                  className={'room-control ' + (!camera ? 'off' : '')}
                  disabled={!stream}
                  onClick={() => toggle('video')}
                  aria-label={camera ? 'Turn camera off' : 'Turn camera on'}
                >
                  {camera ? <Video size={20} /> : <VideoOff size={20} />}
                </button>
                <button
                  className={'room-control ' + (sharing ? 'sharing' : '')}
                  disabled={!stream}
                  onClick={share}
                  aria-label={sharing ? 'Stop sharing screen' : 'Share screen'}
                >
                  <MonitorUp size={20} />
                </button>
                <button
                  className="room-control hangup"
                  onClick={leave}
                  aria-label="Leave classroom"
                >
                  <PhoneOff size={20} />
                </button>
              </div>
              <span>ClassOrbit</span>
            </div>
            {status === 'disconnected' && (
              <p className="room-connection-error">
                The connection closed. Leave and rejoin the classroom.
              </p>
            )}
          </div>
          <aside className="room-chat">
            <div className="chat-heading">
              <MessageSquare size={18} />
              <h3>The conversation</h3>
              <span>{allMessages.length}</span>
            </div>
            <div className="chat-messages">
              {allMessages.length ? (
                allMessages.map((m) => (
                  <div
                    className={'chat-message ' + (m.userId === data.user.id ? 'mine' : '')}
                    key={m.id}
                  >
                    <div>
                      <b>{m.name || (m.userId === data.user.id ? 'You' : 'Participant')}</b>
                      <time>
                        {new Date(m.createdAt).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>
                    <p>{m.text}</p>
                  </div>
                ))
              ) : (
                <div className="chat-empty">
                  <MessageSquare size={27} />
                  <p>
                    Say hello.
                    <br />
                    Ask a good question.
                  </p>
                </div>
              )}
              <div ref={chatEnd} />
            </div>
            <form onSubmit={chat} className="chat-input">
              <input
                aria-label="Chat message"
                maxLength={1000}
                placeholder="Add to the conversation…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button aria-label="Send message" disabled={!text.trim() || status !== 'connected'}>
                <Send size={18} />
              </button>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
