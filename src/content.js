// Everything a visitor reads lives here. Edit this file to make the studio yours.
//
// Project images: drop files into /public/projects/ and set `image: 'projects/your-file.jpg'`.
// Leave `image` out and a generated cover is painted from `palette` instead.

export const profile = {
  name: 'Your Name',
  eyebrow: 'Hi, I am',
  role: 'Designer & Developer',
  lede: 'I design and build digital things: interfaces, identities, and the odd interactive room like this one.',
  welcome: 'Welcome to my studio. The lights are off. Let me fix that.',
  // Shown on the monitors once they boot.
  desktopTagline: 'studio online',
};

export const projects = [
  {
    title: 'Orbit Banking',
    desc: 'A calmer mobile bank. Research, product design and a motion system for 40+ screens.',
    tag: 'Product design',
    palette: ['#ff6b3d', '#ffd166', '#1b1b2f'],
  },
  {
    title: 'Monsoon Type',
    desc: 'A variable display typeface inspired by hand-painted shop signs across North India.',
    tag: 'Type design',
    palette: ['#2ec4b6', '#e8f1f2', '#0b3954'],
  },
  {
    title: 'Pulse Health',
    desc: 'Dashboard and design system for a clinic network. 12 teams, one component library.',
    tag: 'Design system',
    palette: ['#7b61ff', '#f5f3ff', '#12002f'],
  },
  {
    title: 'Chai & Code',
    desc: 'Brand identity, packaging and a playful website for a neighbourhood tech café.',
    tag: 'Branding',
    palette: ['#c8553d', '#f28f3b', '#2d1e2f'],
  },
  {
    title: 'Night Market',
    desc: 'Poster series and 3D illustrations for a late-night food festival.',
    tag: '3D / Illustration',
    palette: ['#f72585', '#4cc9f0', '#10002b'],
  },
  {
    title: 'Fieldnotes',
    desc: 'A note-taking app for researchers: offline-first, keyboard-first, calm by default.',
    tag: 'UX / Prototype',
    palette: ['#a7c957', '#f2e8cf', '#386641'],
  },
];

// Shown in the desk computer's "PitchOS" at the end of the story.
export const about = {
  bio: [
    'I make things for screens and for people: products, identities, and experiments like this room.',
    'Most of my best ideas happen at 2 AM with a record spinning and a coffee going cold.',
  ],
  skills: ['Product design', 'Brand identity', 'Motion', '3D / WebGL', 'Front-end', 'Design systems'],
  contact: [
    { label: 'Email', value: 'hello@yourname.com', href: 'mailto:hello@yourname.com' },
    { label: 'Instagram', value: '@yourname', href: 'https://instagram.com/' },
    { label: 'LinkedIn', value: 'in/yourname', href: 'https://linkedin.com/' },
  ],
};

// ---------------------------------------------------------------------------------------
// NIGHT SHIFT: the story visitors play after the lights come on.
// Bulb (a lightbulb that gained consciousness when the switch was flipped) runs the show.
// ---------------------------------------------------------------------------------------
export const story = {
  title: 'Night Shift',
  startTime: 2 * 60, // minutes after midnight when the lights come on
  endTime: 6 * 60 + 59,
  intro: [
    'WHOA. Light! Hi. I’m Bulb. I was born about four seconds ago when you hit that switch.',
    'Bad news: the big pitch is at 7 AM and the deck is… blank. Figma-empty. Tumbleweed-empty.',
    'Good news: this studio runs on SPARKS. Collect all six and the deck basically builds itself. That’s how design works. Probably.',
    'Follow the little glowing arrow. Or don’t. I’m a lightbulb, not your manager.',
  ],
  sparks: [
    {
      id: 'treadmill',
      title: 'Body before brush',
      hint: 'Run 100 m on the treadmill by the window',
      log: 'ran 100 m on the treadmill, straight at the window.',
      done: 'Blood flowing. Ideas flowing. Sweat… also flowing. Spark one!',
    },
    {
      id: 'record',
      title: 'Drop the needle',
      hint: 'Put a record on (turntable on the cube shelf)',
      log: 'dropped the needle. The disco ball came down.',
      done: 'NOW this is a creative atmosphere. Disco ball deployed. You’re welcome.',
    },
    {
      id: 'karaoke',
      title: 'Sing to the neon',
      hint: 'Hit the karaoke stage under the neon sign',
      log: 'sang to the neon.',
      done: 'The neighbours hated it. The algorithm loved it. Spark!',
    },
    {
      id: 'sketch',
      title: 'Sketch the big idea',
      hint: 'Draw something at the worktable and pin it up',
      log: 'sketched the big idea and pinned it to the board.',
      done: 'Is that… a masterpiece? It’s going on the board. It’s going on the board forever.',
    },
    {
      id: 'coffee',
      title: 'Brew the fuel',
      hint: 'Pull a perfect espresso at the coffee bar',
      log: 'pulled a perfect espresso. Heart rate: yes.',
      done: 'Caffeine level: structurally unsafe. You now run 40% faster. Legally I must say: hydrate.',
    },
    {
      id: 'gallery',
      title: 'Study your past lives',
      hint: 'Pick up 3 project frames in the gallery',
      log: 'studied three past projects in the gallery.',
      done: 'Every project is a past version of you. Slightly spooky. Very inspiring.',
    },
  ],
  final: {
    id: 'ship',
    title: 'Ship it',
    hint: 'Sit at the desk and build the pitch',
    locked: 'Not yet! The deck needs all six sparks. Check the list, top-left.',
    ready: 'That’s six sparks. The sun’s coming up. Sit down at the desk. Let’s ship this thing.',
    done: 'SHIPPED. 6:59 AM. The pitch? Nailed it. Now sleep. Or don’t. The studio’s yours.',
  },
  secrets: [
    { id: 'gains', title: 'Gains', text: '10 dumbbell curls. Your pencil hand thanks you.' },
    { id: 'nap', title: 'Power nap', text: 'Eight minutes on the sofa. Felt like eight hours.' },
    { id: 'monstera', title: 'Plant parent', text: 'The monstera grew. It’s watching you now.' },
    { id: 'party', title: 'Party mode', text: 'The second switch was never for the lights.' },
    { id: 'bookworm', title: 'Bookworm', text: 'Read something from the shelf. Knowledge +1.' },
  ],
  idle: [
    'Psst. The glowing arrow is pointing at something. I’m just saying.',
    'You know what this room needs? Another spark.',
    'I once lit an entire IKEA. Long story. The meatballs were involved.',
  ],
  quotes: [
    '“Design is intelligence made visible.” — Alina Wheeler',
    '“Good design is as little design as possible.” — Dieter Rams',
    '“Creativity is allowing yourself to make mistakes. Design is knowing which ones to keep.” — Scott Adams',
    '“The details are not the details. They make the design.” — Charles Eames',
    '“Have no fear of perfection — you’ll never reach it.” — Salvador Dalí',
  ],
};

// Karaoke: each word is one note. `beat` = when it lands (in beats), `pitch` = semitones from A3.
export const karaoke = {
  song: 'Kerning in the Moonlight',
  bpm: 96,
  lines: [
    [['Pixel', 0, 7], ['by', 1, 5], ['pixel', 2, 7], ['I', 3, 9], ['build', 4, 10], ['the', 5, 9], ['night', 6, 7]],
    [['Kerning', 8, 5], ['my', 9, 4], ['feelings', 10, 5], ['till', 11, 7], ['they', 12, 9], ['feel', 13, 7], ['right', 14, 5]],
    [['Ctrl', 16, 7], ['Z', 17, 9], ['my', 18, 10], ['heart', 19, 12], ['but', 20, 10], ['keep', 21, 9], ['the', 22, 7], ['fonts', 23, 9]],
    [['Ship', 24, 12], ['it', 25, 12], ['at', 26, 10], ['sunrise', 27, 9], ['that’s', 28, 7], ['all', 29, 9], ['I', 30, 10], ['want', 31, 12]],
  ],
};
