import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isPlatformAdminEmail } from '@/lib/admin/platform-admin';

export const dynamic = 'force-dynamic';

export default async function PlatformAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Some browsers/extensions may send duplicate `token` cookies.
  // Pick the first cryptographically valid token instead of trusting the first cookie.
  const tokenCandidates = cookies().getAll('token').map((c) => c.value).filter(Boolean);
  const token = tokenCandidates.find((candidate) => !!verifyToken(candidate));
  if (!token) {
    redirect('/login');
  }

  const decoded = verifyToken(token);
  if (!decoded?.userId) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: {
      email: true,
      isActive: true,
    },
  });

  if (!user?.isActive || !isPlatformAdminEmail(user.email)) {
    redirect('/dashboard');
  }

  return <>{children}</>;
}
