import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { canAccess } from '../services/learning.service.js';
export function attachRealtime(server, db) {
  const io = new Server(server, {
    cors: { origin: config.appUrl, credentials: true },
    maxHttpBufferSize: 64000,
  });
  io.use(async (socket, next) => {
    try {
      if (socket.handshake.headers.origin && socket.handshake.headers.origin !== config.appUrl)
        throw new Error('Invalid origin');
      const cookie = socket.handshake.headers.cookie || '';
      const token = cookie
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith('classorbit_session='))
        ?.slice('classorbit_session='.length);
      const payload = jwt.verify(token, config.secret, {
        algorithms: ['HS256'],
      });
      const user = await db.get('user', payload.sub);
      if (!user) throw new Error('Sign in required');
      socket.data.user = { id: user.id, name: user.name, role: user.role };
      next();
    } catch {
      next(new Error('Sign in to join a class'));
    }
  });
  io.on('connection', (socket) => {
    let messages = 0,
      windowStart = Date.now(),
      signals = 0,
      signalStart = Date.now();
    socket.on('join-class', async (liveId, ack = () => {}) => {
      if (typeof ack !== 'function') ack = () => {};
      try {
        if (typeof liveId !== 'string') throw new Error('Invalid class');
        const live = await db.get('liveClass', liveId);
        if (!live) throw new Error('Class not found');
        // Read current role on every join, so revoked permissions take effect.
        const user = await db.get('user', socket.data.user.id);
        await canAccess(db, user, live.courseId);
        const room = 'class:' + liveId;
        if (socket.data.room === room) return ack({ peers: [] });
        if ((io.sockets.adapter.rooms.get(room)?.size || 0) >= 8)
          throw new Error('This small-group room is full (8 participants)');
        if (socket.data.room) {
          socket.to(socket.data.room).emit('peer-left', socket.id);
          socket.leave(socket.data.room);
        }
        const peers = [...(io.sockets.adapter.rooms.get(room) || [])].map((peerId) => ({
          id: peerId,
          user: io.sockets.sockets.get(peerId)?.data.user,
        }));
        await socket.join(room);
        socket.data.room = room;
        socket.data.liveId = liveId;
        ack({ peers, selfId: socket.id });
        socket.to(room).emit('peer-joined', { id: socket.id, user: socket.data.user });
      } catch (e) {
        ack({ error: e.message });
      }
    });
    socket.on('signal', (payload) => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
      const { to, description, candidate } = payload;
      if (typeof to !== 'string') return;
      if (
        description &&
        (typeof description !== 'object' ||
          typeof description.sdp !== 'string' ||
          description.sdp.length > 60000)
      )
        return;
      if (candidate && (typeof candidate !== 'object' || typeof candidate.candidate !== 'string'))
        return;
      if (Date.now() - signalStart > 60000) {
        signals = 0;
        signalStart = Date.now();
      }
      if (++signals > 600) return;
      const peer = io.sockets.sockets.get(to);
      if (!socket.data.room || peer?.data.room !== socket.data.room) return;
      if (description && !['offer', 'answer'].includes(description.type)) return;
      peer.emit('signal', {
        from: socket.id,
        user: socket.data.user,
        description,
        candidate,
      });
    });
    socket.on('chat', async (text, ack = () => {}) => {
      if (typeof ack !== 'function') ack = () => {};
      try {
        if (!socket.data.room) throw new Error('Join a room first');
        if (Date.now() - windowStart > 60000) {
          messages = 0;
          windowStart = Date.now();
        }
        if (++messages > 30) throw new Error('Please slow down');
        if (typeof text !== 'string' || !text.trim() || text.length > 1000)
          throw new Error('Message must contain 1–1000 characters');
        const user = await db.get('user', socket.data.user.id);
        const live = await db.get('liveClass', socket.data.liveId);
        await canAccess(db, user, live.courseId);
        const message = {
          id: randomUUID(),
          liveClassId: socket.data.liveId,
          userId: user.id,
          text: text.trim(),
          createdAt: new Date(),
        };
        await db.insert('chatMessage', message);
        io.to(socket.data.room).emit('chat-message', {
          ...message,
          name: user.name,
        });
        ack({ ok: true });
      } catch (e) {
        ack({ error: e.message });
      }
    });
    socket.on('disconnect', () => {
      if (socket.data.room) socket.to(socket.data.room).emit('peer-left', socket.id);
    });
  });
  return io;
}
