import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Project Folder Dropzone',
  description: 'Upload or drag-and-drop an entire local project folder and read its code files.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased selection:bg-indigo-500/30">
        {children}
      </body>
    </html>
  );
}
