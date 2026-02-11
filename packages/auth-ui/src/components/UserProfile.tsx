import { modelenceQuery } from '@modelence/react-query';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

function SectionRow({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex py-8 border-b border-gray-200 dark:border-gray-800 ${className}`}>
      <div className="w-56 pr-6 text-gray-900 dark:text-white font-medium flex-shrink-0 flex items-start">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function ProfileContent({ profile }: { profile: { handle: string; emails: { address: string; verified: boolean }[]; authMethods: string[], name?: string, picture?: string } }) {
  const name = profile.name || profile.handle.split('@')[0] || 'No name';

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-xl font-semibold mb-8">Profile details</div>
      {/* Profile row */}
      <div className="flex items-center justify-between py-6 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center text-xl font-semibold text-gray-600">
            {profile.picture ? <img src={profile.picture} alt="Profile" className="w-full h-full rounded-full" /> : name[0].toUpperCase()}
          </div>
          <div>
            <div className="font-medium text-lg text-gray-900 dark:text-white">{name}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">Profile</div>
          </div>
        </div>
        {/* <Button size="sm" className="font-medium">Edit profile</Button> */}
      </div>

      <SectionRow label="Email addresses">
        <div className="flex flex-col gap-1">
          {profile.emails.map((email, index) => (
            <div key={email.address} className="flex items-center gap-2">
              <span>{email.address}</span>
              {index === 0 && (
                <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded">Primary</span>
              )}
              {email.verified && (
                <span className="text-xs bg-green-100 dark:bg-green-800 text-green-600 dark:text-green-300 px-2 py-0.5 rounded">Verified</span>
              )}
            </div>
          ))}
        </div>
        {/* <Button variant="link" size="sm" className="pl-0 text-blue-600 dark:text-blue-400 font-medium">+ Add email address</Button> */}
      </SectionRow>

      {/* <SectionRow label="Phone number">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-gray-400">No phone</span>
        </div>
        <Button variant="link" size="sm" className="pl-0 text-blue-600 dark:text-blue-400 font-medium">+ Add phone number</Button>
      </SectionRow> */}

      {/* <SectionRow label="Login methods" className="border-b-0">
        <div className="flex flex-col gap-2 mb-2">
          {profile.authMethods.map((method) => (
            <div key={method} className="flex items-center gap-2">
              {method === 'google' && <GoogleIcon className="w-5 h-5" />}
              <span className="text-gray-700 dark:text-gray-200 capitalize">{method}</span>
            </div>
          ))}
          {profile.authMethods.length === 0 && (
            <span className="text-gray-400">No login methods</span>
          )}
        </div>
        <Button variant="link" size="sm" className="pl-0 text-blue-600 dark:text-blue-400 font-medium">+ Connect account</Button>
      </SectionRow> */}
    </div>
  );
}

function SecurityContent() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-xl font-semibold mb-8">Security</div>
      <div className="text-gray-500 dark:text-gray-400">Security settings coming soon...</div>
    </div>
  );
}

function SettingsContent({
  onDeleteAccount,
}: {
  onDeleteAccount?: () => void;
}) {
  // const handleDownloadData = () => {
  //   // TODO: Implement data download
  //   console.log('Download data requested');
  // };

  // const handleDeleteAccount = () => {
  //   // TODO: Implement account deletion with confirmation
  //   if (window.confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
  //     console.log('Account deletion requested');
  //   }
  // };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-xl font-semibold mb-8">Settings</div>

      {/* Data Privacy */}
      {/* <SectionRow label="Data Privacy">
        <div className="space-y-4">
          <div>
            <div className="font-medium text-gray-900 dark:text-white mb-2">Download your data</div>
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Get a copy of all your data in a portable format. This includes your profile information, emails, and account activity.
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleDownloadData}
              className="font-medium"
            >
              Download data
            </Button>
          </div>
          
          <div>
            <div className="font-medium text-gray-900 dark:text-white mb-2">Data portability</div>
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              You have the right to receive your personal data in a structured, commonly used format.
            </div>
            <Button 
              variant="link" 
              size="sm" 
              className="pl-0 text-blue-600 dark:text-blue-400 font-medium"
            >
              Learn more about your rights
            </Button>
          </div>
        </div>
      </SectionRow> */}

      {/* Account Management */}
      <SectionRow label="Account Management" className="border-b-0">
        <div className="space-y-4">
          <div>
            <div className="font-medium text-gray-900 dark:text-white mb-2">Delete account</div>
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Permanently delete your account and all associated data. This action cannot be undone.
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={onDeleteAccount}
              className="font-medium"
            >
              Delete account
            </Button>
          </div>
        </div>
      </SectionRow>
    </div>
  );
}

type TabType = 'profile' | 'security' | 'settings';

type ProfileData = {
  handle: string;
  emails: { address: string; verified: boolean }[];
  authMethods: string[];
  name?: string;
  picture?: string;
};

function UserProfileContent({
  onDeleteAccount,
}: { onDeleteAccount?: () => void }) {
  const [activeTab, setActiveTab] = useState<TabType>('profile');

  const { data: profile, isLoading, error } = useQuery({
    ...modelenceQuery<ProfileData>('_system.user.getOwnProfile'),
  });

  if (isLoading) return <div>Loading profile...</div>;
  if (error) return <div>Error loading profile: {error.message}</div>;
  if (!profile) return null;

  const tabs: {
    id: TabType;
    label: string;
    icon: React.ReactNode;
  }[] = [
      {
        id: 'profile' as const, label: 'Profile', icon: (
          <svg width="20" height="20" fill="none" viewBox="0 0 20 20">
            <circle cx="10" cy="6" r="4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M2.5 17c0-2.485 3.358-4.5 7.5-4.5s7.5 2.015 7.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )
      },
      // { id: 'security' as const, label: 'Security', icon: (
      //   <svg width="20" height="20" fill="none" viewBox="0 0 20 20">
      //     <rect x="5" y="8" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      //     <path d="M7 8V6a3 3 0 116 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      //   </svg>
      // )},
    ];

  if (onDeleteAccount) {
    tabs.push(
      {
        id: 'settings' as const, label: 'Settings', icon: (
          <svg width="20" height="20" fill="none" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="2.8" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11.08 17.6h-2.16l-.6-1.84c-.4-.12-.8-.28-1.16-.48l-1.76.88-1.52-1.52.88-1.76c-.2-.36-.36-.76-.48-1.16L2.4 11.08v-2.16l1.84-.6c.12-.4.28-.8.48-1.16l-.88-1.76 1.52-1.52 1.76.88c.36-.2.76-.36 1.16-.48L8.92 2.4h2.16l.6 1.84c.4.12.8.28 1.16.48l1.76-.88 1.52 1.52-.88 1.76c.2.36.36.76.48 1.16l1.84.6v2.16l-1.84.6c-.12.4-.28.8-.48 1.16l.88 1.76-1.52 1.52-1.76-.88c-.36.2-.76.36-1.16.48l-.6 1.84z" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        )
      });
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'profile':
        return <ProfileContent profile={profile} />;
      case 'security':
        return <SecurityContent />;
      case 'settings':
        return <SettingsContent onDeleteAccount={onDeleteAccount} />;
      default:
        return <ProfileContent profile={profile} />;
    }
  };

  return (
    <Card className="flex min-h-[600px] w-full max-w-4xl mx-auto overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 rounded-l-xl flex flex-col py-8 px-6">
        <div className="mb-8">
          <div className="text-2xl font-semibold text-gray-900 dark:text-white mb-1">Account</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Manage your account info.</div>
        </div>
        <nav className="flex flex-col gap-2 mt-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg font-medium transition-colors ${activeTab === tab.id
                ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
            >
              <span className="inline-block w-5 text-center">
                {tab.icon}
              </span>
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>
      {/* Main content */}
      <main className="flex-1 bg-white dark:bg-gray-900 rounded-r-xl p-12">
        {renderContent()}
      </main>
    </Card>
  );
}

// Create a QueryClient instance
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

export function UserProfile({
  onDeleteAccount,
}: {
  onDeleteAccount?: () => void;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <UserProfileContent onDeleteAccount={onDeleteAccount} />
    </QueryClientProvider>
  );
}
