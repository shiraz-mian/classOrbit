import { PrismaClient } from '@prisma/client';
import { config } from '../server/src/config/index.js';

if (config.demo || config.production)
  throw new Error('Use DEMO_MODE=false with a development database.');
const db = new PrismaClient({ log: [] });
const id = 'sample-web-development';
try {
  const existing = await db.course.findUnique({
    where: { id },
    include: { _count: { select: { lessons: true, quizzes: true } } },
  });
  if (existing) {
    console.log('Sample course already exists; existing content and progress were preserved.');
    console.log(
      existing.title +
        ': ' +
        existing._count.lessons +
        ' lessons, ' +
        existing._count.quizzes +
        ' quiz.',
    );
  } else {
    const instructor = await db.user.findFirst({
      where: { role: 'INSTRUCTOR', instructorApproved: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!instructor)
      throw Object.assign(
        new Error('An admin must approve an instructor before adding this sample course.'),
        { code: 'NO_APPROVED_INSTRUCTOR' },
      );
    await db.course.create({
      data: {
        id,
        title: 'Build your first web page',
        description:
          'A free beginner course on HTML, CSS, and JavaScript. Build a personal profile page, practice with small exercises, and pass a knowledge check to earn a ClassOrbit certificate. Includes a clearly labeled sample video for trying the player.',
        category: 'Development',
        level: 'Beginner',
        price: 0,
        color: 'coral',
        status: 'PUBLISHED',
        instructorId: instructor.id,
        lessons: {
          create: [
            {
              id: id + '-html',
              title: 'Give your page a structure with HTML',
              position: 1,
              duration: 10,
              videoStatus: 'EMPTY',
              sampleVideo:
                'https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4',
              content:
                'HTML describes the meaning and structure of a web page. Use headings for a clear outline, paragraphs for ideas, links for navigation, and lists for related items. A semantic element describes its purpose: header introduces the page, main contains its primary content, and footer holds supporting information.\n\nCreate a file named index.html. Start with <!doctype html>, then add html, head, and body elements. Put a title inside head. Inside body, add main, one h1 with your name, a paragraph about what you are learning, and a list of three interests. Set the document language and provide a viewport meta tag so the page adapts to phones.\n\nPractice: Open your page in a browser. Check that the tab has your title and the page has a single clear main heading. Add a link to a helpful learning resource with text that describes its destination.\n\nPlayer demonstration: the accompanying Big Buck Bunny clip is an open movie from the Blender Foundation. It demonstrates video playback and is not instructional HTML footage. The written lesson and exercises contain the course material.',
            },
            {
              id: id + '-css',
              title: 'Make the layout readable with CSS',
              position: 2,
              duration: 12,
              videoStatus: 'EMPTY',
              content:
                'CSS controls presentation. A selector chooses elements, a property names the feature to change, and a value describes the result. For example, body { font-family: sans-serif; line-height: 1.6; } sets a readable typeface and spacing. Put styles in a separate styles.css file and link it from the document head.\n\nThe box model includes content, padding, border, and margin. Padding adds room inside an element; margin separates it from neighbors. Start with box-sizing: border-box so the declared width includes padding and borders. Give main a comfortable maximum width, center it with margin-inline: auto, and add padding for small screens.\n\nUse display: flex for a row or column of items and gap to separate them. Avoid fixed page widths. Set images to max-width: 100% and keep body text at a comfortable size. Use sufficient contrast, visible keyboard focus, and spacing that helps people scan the content.\n\nPractice: Style your profile page with one accent color. Resize the browser from a wide window to a narrow phone-sized window. The text should remain readable and the page should not scroll sideways. Use the keyboard to focus your link and make sure its outline is visible.',
            },
            {
              id: id + '-javascript',
              title: 'Add a small interaction with JavaScript',
              position: 3,
              duration: 12,
              videoStatus: 'EMPTY',
              content:
                'JavaScript adds behavior. Variables store values, functions group actions, and events describe interactions such as a button click. The document object lets you find and update elements on the page. Keep content updates safe: use textContent for text instead of inserting untrusted HTML.\n\nAdd a button with type="button" and id="greet" and a paragraph with id="message" and aria-live="polite". In a separate script.js file, find the button with document.querySelector("#greet"). Use addEventListener("click", ...) to set the paragraph textContent to a short greeting. Load the script with defer so the document is parsed first.\n\nKeep the button usable with a keyboard and give it a clear label such as Show greeting. A real button already supports keyboard interaction. Use the browser Console to identify errors and fix one issue at a time.\n\nPractice: Make the greeting include your name. Then add a second button to clear it. Explain how an event listener connects an interaction to the function that handles it.\n\nFinish: Review your page, mark all three lessons complete, and take the knowledge check. Passing the quiz and completing each lesson unlocks your certificate.',
            },
          ],
        },
        quizzes: {
          create: [
            {
              id: id + '-quiz',
              title: 'Your first web page: knowledge check',
              passScore: 70,
              questions: [
                {
                  prompt: 'Which technology describes a page’s structure and meaning?',
                  options: ['HTML', 'CSS', 'PostgreSQL'],
                  correct: 0,
                  explanation: 'HTML provides the content structure and semantic elements.',
                },
                {
                  prompt: 'Which CSS property adds space inside an element?',
                  options: ['margin', 'padding', 'color'],
                  correct: 1,
                  explanation: 'Padding adds space between the content and the element border.',
                },
                {
                  prompt: 'How should JavaScript respond to a button click?',
                  options: [
                    'By storing a database password in the page',
                    'By adding more heading tags',
                    'By registering a click event listener',
                  ],
                  correct: 2,
                  explanation: 'An event listener runs a handler when the click occurs.',
                },
              ],
            },
          ],
        },
      },
    });
    console.log('Added free sample course: Build your first web page (3 lessons, 1 quiz).');
  }
  console.log(
    'Open Explore courses and select Build your first web page. No student enrollments or completions were added.',
  );
} catch (error) {
  console.error(
    error.code === 'NO_APPROVED_INSTRUCTOR'
      ? error.message
      : 'Sample course setup failed' +
          (error.code ? ' (' + error.code + ')' : '') +
          '. Existing records were not replaced.',
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
