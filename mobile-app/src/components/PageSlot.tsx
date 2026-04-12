import React from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fontSize, spacing, borderRadius, androidRipple } from '../theme';

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
  const displayUri = imageUri || imageUrl;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>P{pageNumber}</Text>
        {hasImage && displayUri && (
          <Pressable onPress={onPreview} hitSlop={8}>
            <Image source={{ uri: displayUri }} style={styles.thumbnail} />
          </Pressable>
        )}
        {hasImage && !displayUri && (
          <View style={styles.tick}>
            <Ionicons name="checkmark-circle" size={20} color={colors.green} />
          </View>
        )}
      </View>
      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.scanBtn,
            disabled && styles.disabled,
            Platform.OS === 'ios' && pressed && styles.pressed,
          ]}
          onPress={onScan}
          disabled={disabled}
          android_ripple={androidRipple}
        >
          <Ionicons name="camera-outline" size={14} color={colors.white} />
          <Text style={styles.scanBtnText}>Scan</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.galleryBtn,
            disabled && styles.disabled,
            Platform.OS === 'ios' && pressed && styles.pressed,
          ]}
          onPress={onPickGallery}
          disabled={disabled}
          android_ripple={androidRipple}
        >
          <Ionicons name="image-outline" size={14} color={colors.gray700} />
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
    letterSpacing: 0.8,
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.gray100,
  },
  tick: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
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
  pressed: {
    transform: [{ scale: 0.98 }],
  },
});
