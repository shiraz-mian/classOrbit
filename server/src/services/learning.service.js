import { randomUUID } from 'node:crypto';
export const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
export const safeUser = ({ passwordHash, instructorApproved = false, ...user }) => ({
  ...user,
  instructorApproved,
});
export async function canAccess(db, user, courseId) {
  const c = await db.get('course', courseId);
  if (!c) fail(404, 'Course not found');
  if (!user) fail(401, 'Sign in to continue');
  if (user.role === 'ADMIN' || c.instructorId === user.id) return c;
  if (!(await db.all('enrollment', { userId: user.id, courseId })).length)
    fail(403, 'Enroll in this course first');
  return c;
}
export async function canEdit(db, user, courseId) {
  const c = await db.get('course', courseId);
  if (!c) fail(404, 'Course not found');
  if (user.role !== 'ADMIN' && c.instructorId !== user.id)
    fail(403, 'You can only edit your own courses');
  return c;
}
export async function completion(db, userId, courseId) {
  const lessons = await db.all('lesson', { courseId });
  const progress = await db.all('progress', { userId });
  const completed = lessons.filter((l) => progress.some((p) => p.lessonId === l.id)).length;
  const quizzes = await db.all('quiz', { courseId });
  const attempts = await db.all('attempt', { userId });
  const quizzesPassed = quizzes.every((q) => attempts.some((a) => a.quizId === q.id && a.passed));
  return {
    completed,
    total: lessons.length,
    percent: lessons.length ? Math.round((completed / lessons.length) * 100) : 0,
    quizzesPassed,
    eligible: lessons.length > 0 && completed === lessons.length && quizzesPassed,
  };
}
export function grade(quiz, answers) {
  if (
    !Array.isArray(answers) ||
    answers.length !== quiz.questions.length ||
    answers.some((a, i) => !Number.isInteger(a) || a < 0 || a >= quiz.questions[i].options.length)
  )
    fail(400, 'Answer every question with a valid option');
  const correct = quiz.questions.filter((q, i) => q.correct === answers[i]).length;
  const score = Math.round((correct / quiz.questions.length) * 100);
  return {
    score,
    passed: score >= quiz.passScore,
    feedback: quiz.questions.map((q, i) => ({
      correct: answers[i] === q.correct,
      answer: q.correct,
      explanation: q.explanation || '',
    })),
  };
}
export async function fulfillPayment(db, payment) {
  return db.atomic(async (tx) => {
    if (await tx.get('payment', payment.id)) return;
    const course = await tx.get('course', payment.courseId);
    if (
      !course ||
      !Number.isSafeInteger(payment.amount) ||
      payment.amount <= 0 ||
      payment.amount !== course.price ||
      !['inr', 'usd'].includes(payment.currency)
    )
      fail(400, 'Payment does not match the course price');
    if (!(await tx.get('user', payment.userId))) fail(400, 'Payment account not found');
    await tx.insert('payment', { ...payment, status: 'PAID', createdAt: new Date() });
    if (
      !(await tx.all('enrollment', { userId: payment.userId, courseId: payment.courseId })).length
    )
      await tx.insert('enrollment', {
        id: randomUUID(),
        userId: payment.userId,
        courseId: payment.courseId,
        createdAt: new Date(),
      });
  });
}
