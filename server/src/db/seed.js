import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
export async function seed(db) {
  if ((await db.all('user')).length) return;
  const passwordHash = await bcrypt.hash('ClassOrbit123!', 10);
  const createdAt = new Date();
  await db.atomic(async (tx) => {
    for (const [id, name, email, role] of [
      ['student-demo', 'Alex Morgan', 'student@classorbit.dev', 'STUDENT'],
      ['instructor-demo', 'Jordan Lee', 'instructor@classorbit.dev', 'INSTRUCTOR'],
      ['admin-demo', 'Sam Taylor', 'admin@classorbit.dev', 'ADMIN'],
    ])
      await tx.insert('user', {
        id,
        name,
        email,
        role,
        instructorApproved: role === 'INSTRUCTOR',
        passwordHash,
        createdAt,
      });
    const courses = [
      {
        id: 'react-foundations',
        title: 'React: from foundations to fluency',
        description:
          'Build your confidence with components, hooks, and state. Create a thoughtful, interactive app one small step at a time.',
        category: 'Development',
        level: 'Beginner',
        price: 4900,
        color: 'coral',
        topics: [
          'Thinking in components',
          'Props and composition',
          'State that makes sense',
          'Effects and data fetching',
          'Build your first project',
        ],
      },
      {
        id: 'design-systems',
        title: 'Design systems that scale',
        description:
          'Turn individual screens into a consistent visual language. Explore typography, color, accessible components, and design tokens.',
        category: 'Design',
        level: 'Intermediate',
        price: 3900,
        color: 'lilac',
        topics: [
          'A shared visual language',
          'Typography and spacing',
          'Accessible color systems',
          'Reusable components',
        ],
      },
      {
        id: 'node-api',
        title: 'The practical Node.js API workshop',
        description:
          'Go beyond hello world. Design REST endpoints, validate requests, connect a database, and ship a reliable backend.',
        category: 'Development',
        level: 'Intermediate',
        price: 5900,
        color: 'mint',
        topics: [
          'How an HTTP request works',
          'Routing with Express',
          'Validation and errors',
          'PostgreSQL and Prisma',
          'Authentication essentials',
        ],
      },
      {
        id: 'learning-habits',
        title: 'Make learning a daily habit',
        description:
          'A short, free course on focus, deliberate practice, and making steady progress. Find a routine that works for you.',
        category: 'Personal growth',
        level: 'All levels',
        price: 0,
        color: 'sand',
        topics: ['Start smaller than you think', 'Practice with intention', 'Reflect and repeat'],
      },
    ];
    for (const c of courses) {
      const { topics, ...data } = c;
      await tx.insert('course', {
        ...data,
        status: 'PUBLISHED',
        instructorId: 'instructor-demo',
        createdAt,
      });
      for (const [i, title] of topics.entries()) {
        await tx.insert('lesson', {
          id: c.id + '-lesson-' + i,
          courseId: c.id,
          title,
          content: lessonContent(c.category, title),
          position: i + 1,
          duration: 8 + i * 3,
          videoStatus: 'EMPTY',
          videoPath: null,
          sampleVideo:
            i === 0
              ? 'https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4'
              : null,
        });
      }
      await tx.insert('quiz', {
        id: c.id + '-quiz',
        courseId: c.id,
        title: 'Knowledge check',
        passScore: 70,
        questions: quizFor(c.id),
      });
    }
    for (const courseId of ['react-foundations', 'learning-habits'])
      await tx.insert('enrollment', {
        id: randomUUID(),
        userId: 'student-demo',
        courseId,
        createdAt,
      });
    for (const lessonId of [
      'react-foundations-lesson-0',
      'react-foundations-lesson-1',
      'learning-habits-lesson-0',
      'learning-habits-lesson-1',
      'learning-habits-lesson-2',
    ])
      await tx.insert('progress', {
        id: randomUUID(),
        userId: 'student-demo',
        lessonId,
        completedAt: createdAt,
      });
    await tx.insert('attempt', {
      id: randomUUID(),
      userId: 'student-demo',
      quizId: 'learning-habits-quiz',
      score: 100,
      passed: true,
      answers: [0, 1, 1],
      createdAt,
    });
    await tx.insert('certificate', {
      id: 'CO-DEMO-HABITS',
      userId: 'student-demo',
      courseId: 'learning-habits',
      issuedAt: createdAt,
    });
    await tx.insert('payment', {
      id: 'demo-initial-enrollment',
      userId: 'student-demo',
      courseId: 'react-foundations',
      amount: 4900,
      currency: 'inr',
      status: 'PAID',
      provider: 'DEMO',
      createdAt,
    });
    for (const [index, courseId, title, hours] of [
      [0, 'react-foundations', 'React clinic: let’s talk hooks', 2],
      [1, 'design-systems', 'Behind the design: component critique', 26],
      [2, 'node-api', 'Build an API, together', 50],
    ]) {
      await tx.insert('liveClass', {
        id: 'live-' + index,
        courseId,
        title,
        startsAt: new Date(Date.now() + hours * 3600000),
        duration: 60,
      });
    }
  });
}
function lessonContent(category, title) {
  const intro =
    category === 'Development'
      ? 'Start with a small, working example. Describe the input and the output before writing code. Then improve the implementation in small steps.'
      : category === 'Design'
        ? 'A strong system makes the next decision easier. Start by identifying repeated patterns and the needs of the people who use them.'
        : 'Progress comes from consistent, manageable steps. Choose a time and a place for your next practice session.';
  return (
    title +
    '\n\n' +
    intro +
    '\n\nTry it yourself\nWrite down three ideas from this lesson. Apply one of them to a small project, and explain your choice in your own words.\n\nReflection\nWhat felt clear? What would you like to explore further? Keep a short learning journal as you work through the course.\n\nThis is sample lesson content for the ClassOrbit demo. Instructors can add their own lesson text and upload videos in the Studio.'
  );
}
function quizFor(id) {
  if (id === 'react-foundations')
    return [
      {
        prompt: 'What does a React component return?',
        options: ['A description of the UI', 'A database connection', 'A CSS file'],
        correct: 0,
        explanation: 'Components describe the interface, commonly using JSX.',
      },
      {
        prompt: 'Which hook stores local component state?',
        options: ['useEffect', 'useState', 'useMemo'],
        correct: 1,
        explanation: 'useState stores a value and provides a setter that requests a render.',
      },
      {
        prompt: 'Why should list items have stable keys?',
        options: ['To change their colors', 'To help React preserve identity', 'To sort the array'],
        correct: 1,
        explanation: 'Keys identify items between renders.',
      },
    ];
  if (id === 'node-api')
    return [
      {
        prompt: 'Which HTTP method usually creates a resource?',
        options: ['GET', 'POST', 'HEAD'],
        correct: 1,
        explanation: 'POST commonly creates resources.',
      },
      {
        prompt: 'Where must input validation happen?',
        options: ['On the server', 'Only in CSS', 'Only in the browser'],
        correct: 0,
        explanation: 'The server must validate every request regardless of client behavior.',
      },
      {
        prompt: 'Which code means unauthenticated?',
        options: ['200', '401', '500'],
        correct: 1,
        explanation: '401 means authentication is required.',
      },
    ];
  if (id === 'design-systems')
    return [
      {
        prompt: 'What is a design token?',
        options: ['A reusable named design value', 'An API password', 'A screenshot'],
        correct: 0,
        explanation: 'Tokens name decisions such as color and spacing.',
      },
      {
        prompt: 'Why test color contrast?',
        options: ['To make files smaller', 'To improve readability', 'To hide errors'],
        correct: 1,
        explanation: 'Contrast supports readable interfaces.',
      },
      {
        prompt: 'A reusable component should have…',
        options: ['No documentation', 'Clear behavior and states', 'Only one screen size'],
        correct: 1,
        explanation: 'Documented states make components consistent and usable.',
      },
    ];
  return [
    {
      prompt: 'A sustainable new habit starts with…',
      options: ['A small repeatable action', 'An all-night session', 'No plan'],
      correct: 0,
      explanation: 'Small actions are easier to repeat consistently.',
    },
    {
      prompt: 'Deliberate practice includes…',
      options: ['Avoiding feedback', 'Focused practice and feedback', 'Only watching videos'],
      correct: 1,
      explanation: 'Use feedback to improve a specific skill.',
    },
    {
      prompt: 'Reflection helps you…',
      options: ['Skip practice', 'Identify your next step', 'Avoid difficult topics'],
      correct: 1,
      explanation: 'Reflection turns experience into a plan for improvement.',
    },
  ];
}
