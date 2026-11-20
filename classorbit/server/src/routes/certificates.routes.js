import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { config } from '../config/index.js';
import { auth } from '../middleware/auth.js';
import { fail, canAccess, completion } from '../services/learning.service.js';
const id = () => randomUUID();

export function createRouter(db) {
  const app = Router();
  app.post('/api/courses/:courseId/certificate', auth, async (req, res) => {
    await canAccess(db, req.user, req.params.courseId);
    const cert = await db.atomic(async (tx) => {
      if (!(await completion(tx, req.user.id, req.params.courseId)).eligible)
        fail(400, 'Complete every lesson and pass every quiz to earn this certificate');
      const [existing] = await tx.all('certificate', {
        userId: req.user.id,
        courseId: req.params.courseId,
      });
      return (
        existing ||
        tx.insert('certificate', {
          id: id(),
          userId: req.user.id,
          courseId: req.params.courseId,
          issuedAt: new Date(),
        })
      );
    });
    res.json(cert);
  });
  app.get('/api/certificates/:certificateId/verify', async (req, res) => {
    const c = await db.get('certificate', req.params.certificateId);
    if (!c) fail(404, 'Certificate not found');
    const user = await db.get('user', c.userId);
    const course = await db.get('course', c.courseId);
    res.json({
      id: c.id,
      name: user.name,
      course: course.title,
      issuedAt: c.issuedAt,
      valid: true,
    });
  });
  app.get('/api/certificates/:certificateId/pdf', auth, async (req, res) => {
    const c = await db.get('certificate', req.params.certificateId);
    if (!c) fail(404, 'Certificate not found');
    if (c.userId !== req.user.id && req.user.role !== 'ADMIN')
      fail(403, 'This certificate belongs to another learner');
    const user = await db.get('user', c.userId);
    const course = await db.get('course', c.courseId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="ClassOrbit-certificate.pdf"');
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 50 });
    doc.pipe(res);
    doc.rect(0, 0, 842, 595).fill('#fbf8f1');
    doc.rect(24, 24, 794, 547).lineWidth(2).stroke('#d5b67d');
    doc.fillColor('#17283a').font('Helvetica-Bold').fontSize(24).text('ClassOrbit', 60, 60);
    doc.font('Helvetica').fontSize(12).text('LEARN. CONNECT. GROW.', 60, 95);
    doc.fontSize(14).text('CERTIFICATE OF COMPLETION', 60, 158, { width: 722, align: 'center' });
    doc.fontSize(14).text('This is to recognize', 60, 205, { width: 722, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(36);
    if (doc.widthOfString(user.name) > 700)
      doc.fontSize(Math.max(18, (36 * 700) / doc.widthOfString(user.name)));
    doc.text(user.name, 60, 240, { width: 722, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(14)
      .text('for successfully completing', 60, 302, { width: 722, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .fontSize(23)
      .text(course.title, 70, 338, { width: 702, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        'Issued ' +
          new Date(c.issuedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
        60,
        460,
      );
    doc.text('Certificate ID: ' + c.id, 60, 484);
    doc.text('Verify: ' + config.appUrl + '/api/certificates/' + c.id + '/verify', 60, 505, {
      width: 720,
    });
    doc.end();
  });

  return app;
}
