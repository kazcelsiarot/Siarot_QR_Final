import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import AppButton from '@/components/AppButton';
import GradientBackground from '@/components/GradientBackground';
import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { registerAttendance } from '@/lib/attendance';

export default function ScanScreen() {
  const { user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [lastData, setLastData] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    setScanned(true);
    setLastData(data);

    const studentId = user?.id ?? 'unknown';

    registerAttendance(data, studentId).then((result) => {
      setMessage(result.message);
      setSuccess(result.success);
    });
  };

  const handleScanAgain = () => {
    setScanned(false);
    setLastData(null);
    setMessage(null);
  };

  if (!permission) {
    return (
      <GradientBackground>
        <View style={styles.container} />
      </GradientBackground>
    );
  }

  if (!permission.granted) {
    return (
      <GradientBackground>
        <View style={styles.container}>
          <Text style={styles.title}>
            Camera Permission Needed
          </Text>
          <Text style={styles.subtitle}>
            We need access to your camera to scan QR codes.
          </Text>
          <AppButton
            theme="primary"
            title="Grant Permission"
            icon="camera"
            onPress={requestPermission}
          />
        </View>
      </GradientBackground>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
      />

      <View style={styles.overlay}>
        <Text style={styles.overlayText}>
          {scanned
            ? 'QR Code detected!'
            : 'Point your camera at a QR code'}
        </Text>

        {scanned && message ? (
          <Text
            style={[
              styles.scanResult,
              success ? styles.success : styles.error,
            ]}
          >
            {message}
          </Text>
        ) : null}

        {scanned && lastData ? (
          <Text style={styles.scanData}>{lastData}</Text>
        ) : null}

        {scanned ? (
          <AppButton
            theme="primary"
            title="Scan Again"
            icon="refresh"
            onPress={handleScanAgain}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },

  camera: {
    ...StyleSheet.absoluteFillObject,
  },

  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FED7B8',
    marginBottom: 8,
    textAlign: 'center',
    textShadowColor: 'rgba(58, 15, 18, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  subtitle: {
    fontSize: 14,
    color: 'rgba(254, 215, 184, 0.9)',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
    textShadowColor: 'rgba(58, 15, 18, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  overlay: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    padding: 16,
    alignItems: 'center',
  },

  overlayText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
    textAlign: 'center',
  },

  scanResult: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: '600',
  },

  success: { color: COLORS.success },
  error: { color: COLORS.danger },

  scanData: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 12,
  },
});
