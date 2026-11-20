import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
export function useLiveRoom({ id, enabled, stream, iceServers, onError }) {
  const [peers, setPeers] = useState([]),
    [messages, setMessages] = useState([]),
    [status, setStatus] = useState('offline');
  const socketRef = useRef(),
    connections = useRef(new Map());
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const socket = io({ withCredentials: true, reconnection: false });
    socketRef.current = socket;
    const update = (peerId, patch) => {
      if (!disposed)
        setPeers((p) =>
          p.some((v) => v.id === peerId)
            ? p.map((v) => (v.id === peerId ? { ...v, ...patch } : v))
            : [...p, { id: peerId, ...patch }],
        );
    };
    function getPeer(peerId, user) {
      if (connections.current.has(peerId)) return connections.current.get(peerId);
      const pc = new RTCPeerConnection({ iceServers });
      const entry = { pc, queue: [] };
      connections.current.set(peerId, entry);
      update(peerId, { user, state: 'connecting' });
      stream?.getTracks().forEach((track) => pc.addTrack(track, stream));
      if (!stream) {
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
      }
      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('signal', { to: peerId, candidate: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => {
        let remote = e.streams[0];
        if (!remote) {
          remote = entry.remote || new MediaStream();
          remote.addTrack(e.track);
          entry.remote = remote;
        }
        update(peerId, { stream: remote });
      };
      pc.onconnectionstatechange = () => {
        update(peerId, { state: pc.connectionState });
      };
      return entry;
    }
    socket.on('connect', () => {
      setStatus('joining');
      socket.emit('join-class', id, async (result) => {
        if (result.error) {
          setStatus('error');
          onError(result.error);
          socket.disconnect();
          return;
        }
        setStatus('connected');
        for (const peer of result.peers) {
          try {
            const { pc } = getPeer(peer.id, peer.user);
            await pc.setLocalDescription(await pc.createOffer());
            socket.emit('signal', { to: peer.id, description: pc.localDescription.toJSON() });
          } catch (e) {
            onError('Could not connect a participant: ' + e.message);
          }
        }
      });
    });
    socket.on('peer-joined', (peer) => update(peer.id, { user: peer.user, state: 'connecting' }));
    socket.on('signal', async ({ from, user, description, candidate }) => {
      try {
        const entry = getPeer(from, user),
          { pc, queue } = entry;
        if (description) {
          await pc.setRemoteDescription(description);
          for (const c of queue.splice(0)) await pc.addIceCandidate(c);
          if (description.type === 'offer') {
            await pc.setLocalDescription(await pc.createAnswer());
            socket.emit('signal', { to: from, description: pc.localDescription.toJSON() });
          }
        }
        if (candidate) {
          if (pc.remoteDescription) await pc.addIceCandidate(candidate);
          else queue.push(candidate);
        }
      } catch (e) {
        onError('Connection needs attention: ' + e.message);
      }
    });
    socket.on('peer-left', (peerId) => {
      connections.current.get(peerId)?.pc.close();
      connections.current.delete(peerId);
      setPeers((p) => p.filter((v) => v.id !== peerId));
    });
    socket.on('chat-message', (message) => setMessages((m) => [...m, message]));
    socket.on('connect_error', (e) => {
      setStatus('error');
      onError(e.message);
    });
    socket.on('disconnect', () => {
      if (!disposed) setStatus('disconnected');
    });
    return () => {
      disposed = true;
      socket.disconnect();
      socketRef.current = null;
      connections.current.forEach((v) => v.pc.close());
      connections.current.clear();
      setPeers([]);
      setMessages([]);
      setStatus('offline');
    };
  }, [id, enabled, stream]);
  const send = (text) =>
    new Promise((resolve, reject) => {
      if (!socketRef.current?.connected) return reject(new Error('Reconnect to send a message'));
      socketRef.current.timeout(5000).emit('chat', text, (error, result) => {
        if (error || result?.error) reject(new Error(result?.error || 'Message was not sent'));
        else resolve();
      });
    });
  const replaceVideo = async (track) => {
    for (const { pc } of connections.current.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(track);
    }
  };
  return { peers, messages, status, send, replaceVideo };
}
