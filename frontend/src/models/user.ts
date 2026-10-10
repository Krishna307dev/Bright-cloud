export type UserRole = 'admin' | 'friend' | 'pending' | 'ignored';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  lastLogin?: Date;
  role: UserRole;
  createdAt?: Date;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequest {
  uid: string;
  email: string;
  name: string;
  reason: string;
  referredBy: string;
  createdAt: Date | any;
  updatedAt?: Date | any;
  status: ApprovalStatus;
}
