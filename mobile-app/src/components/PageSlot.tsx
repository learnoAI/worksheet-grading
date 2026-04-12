import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fontSize, spacing, borderRadius } from '../theme';

interface PageSlotProps {
  pageNumber: number;
  imageUri?: string | null;
  imageUrl?: string | null;
  disabled?: boolean;
  onScan: () => void;
  onPickGallery: () => void;
  onPreview: () => void;
}

export function PageSlot({
  pageNumber,
  imageUri,
  imageUrl,
  disabled,
  onScan,
  onPickGallery,
  onPreview,
}: PageSlotProps) {
  const hasImage = !!(imageUri || imageUrl);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>P{pageNumber}</Text>
        {hasImage && (
          <Pressable onPress={onPreview} hitSlop={8}>
            <View style={styles.tick}>
              <Text style={styles.tickText}>✓</Text>
            </View>
          </Pressable>
        )}
      </View>
      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [styles.button, styles.scanBtn, disabled && styles.disabled, pressed && { opacity: 0.7 }]}
          onPress={onScan}
          disabled={disabled}
        >
          <Text style={styles.scanBtnText}>Scan</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.button, styles.galleryBtn, disabled && styles.disabled, pressed && { opacity: 0.7 }]}
          onPress={onPickGallery}
          disabled={disabled}
        >
          <Text style={styles.galleryBtnText}>Gallery</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    color: colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.greenLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tickText: {
    fontSize: 13,
    color: colors.green,
    fontWeight: '700',
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  button: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  scanBtn: {
    backgroundColor: colors.primaryDark,
  },
  scanBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.white,
  },
  galleryBtn: {
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  galleryBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.gray700,
  },
  disabled: {
    opacity: 0.4,
  },
});
