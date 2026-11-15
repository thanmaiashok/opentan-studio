import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata = {
  title: 'Open TAN',
  description: 'Images and videos made by Claude. Controlled from Claude Code; this page only shows results.',
  // the OpenTan T (app/icon.svg breaks: Next's metadata loader chokes on the apostrophe in "project's")
  icons: { icon: { url: '/opentan/opentan-T-flat.svg', type: 'image/svg+xml' } },
};

// Set the theme before first paint so there is no light/dark flash.
const themeScript = `try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
