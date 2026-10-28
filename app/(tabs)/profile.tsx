import { useCallback, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import AppButton from '@/components/AppButton';
import GradientBackground from '@/components/GradientBackground';
import { COLORS } from '@/constants/colors';
import { useAuth, signOut } from '@/lib/auth';
import {
  getProfile,
  updateProfile,
  type Profile,
} from '@/lib/profiles';

export default function ProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draftName, setDraftName] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!user) return;

    const p = await getProfile(user.id);
    setProfile(p);
    setDraftName(p?.full_name ?? '');
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  const handleSaveName = async () => {
    if (!user) return;

    setSaving(true);

    const { error } = await updateProfile(user.id, {
      full_name: draftName.trim(),
    });

    setSaving(false);

    if (error) {
      Alert.alert('Error', error);
    } else {
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              full_name: draftName.trim(),
            }
          : prev
      );
      setEditing(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);

    try {
      const { error } = await signOut();

      if (error) {
        Alert.alert('Error', error.message);
      } else {
        router.replace('/login');
      }
    } catch (err: any) {
      Alert.alert(
        'Error',
        err?.message || 'Failed to sign out.'
      );
    } finally {
      setLoading(false);
    }
  };

  const roleLabel = (role: Profile['role'] | undefined) => {
    switch (role) {
      case 'admin':
        return 'Admin';
      case 'teacher':
        return 'Teacher';
      case 'student':
        return 'Student';
      default:
        return 'Unknown';
    }
  };

  return (
    <GradientBackground>
      <View style={styles.container}>
        <Text style={styles.title}>My Profile</Text>

        {user && (
          <View style={styles.infoCard}>
            <Text style={styles.label}>Name</Text>

            {editing ? (
              <View>
                <TextInput
                  style={styles.input}
                  value={draftName}
                  onChangeText={setDraftName}
                  placeholder="Enter your name"
                  placeholderTextColor={COLORS.textSecondary}
                  editable={!saving}
                />

                <View style={styles.editButtons}>
                  <AppButton
                    title={saving ? 'Saving...' : 'Save'}
                    icon="save-outline"
                    onPress={handleSaveName}
                    disabled={saving}
                  />

                  <AppButton
                    title="Cancel"
                    icon="close-outline"
                    onPress={() => {
                      setDraftName(profile?.full_name ?? '');
                      setEditing(false);
                    }}
                    disabled={saving}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.nameRow}>
                <Text style={styles.value}>
                  {profile?.full_name || 'Tap to add your name'}
                </Text>

                <AppButton
                  title="Edit"
                  icon="create-outline"
                  onPress={() => setEditing(true)}
                />
              </View>
            )}

            <Text style={styles.label}>Role</Text>

            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>
                {roleLabel(profile?.role)}
              </Text>
            </View>

            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>
              {profile?.email ?? user.email}
            </Text>

            <Text style={styles.label}>User ID</Text>
            <Text style={styles.valueSmall}>{user.id}</Text>
          </View>
        )}

        <AppButton
          title="Sign Out"
          icon="log-out-outline"
          onPress={handleSignOut}
          disabled={loading}
        />
      </View>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 24,
    paddingTop: 24,
  },

  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FED7B8',
    marginBottom: 16,
    textShadowColor: 'rgba(58, 15, 18, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  infoCard: {
    backgroundColor: 'rgba(254, 215, 184, 0.92)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    padding: 16,
    marginBottom: 24,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },

  label: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 4,
    marginTop: 8,
  },

  value: {
    fontSize: 15,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },

  valueSmall: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },

  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
    marginBottom: 12,
  },

  editButtons: {
    marginBottom: 8,
  },

  nameRow: {
    marginBottom: 8,
  },

  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.75)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 8,
  },

  roleText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
});
