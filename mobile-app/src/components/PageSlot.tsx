import React from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fontSize, spacing, borderRadius } from '../theme';

interface PageSlotProps {
  pageNumber: number;
  imageUri?: string | null;
  imageUrl?: string | null; // remote URL from database
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
  const displayUri = imageUri || imageUrl;
  const hasImage = !!displayUri;
  const isSaved = !imageUri && !!imageUrl;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Page {pageNumber}</Text>

      {hasImage ? (
        <Pressable onPress={onPreview} style={styles.previewContainer}>
          <Image source={{ uri: displayUri! }} style={styles.thumbnail} resizeMode="cover" />
          <Text style={styles.statusText}>
            {isSaved ? 'Saved' : 'Ready'}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.emptySlot}>
          <Text style={styles.emptyText}>No image</Text>
        </View>
      )}

      <View style={styles.buttons}>
        <Pressable
          style={[styles.actionButton, styles.scanButton, disabled && styles.disabled]}
          onPress={onScan}
          disabled={disabled}
        >
          <Text style={styles.scanButtonText}>Scan</Text>
        </Pressable>
        <Pressable
          style={[styles.actionButton, styles.galleryButton, disabled && styles.disabled]}
          onPress={onPickGallery}
          disabled={disabled}
        >
          <Text style={styles.galleryButtonText}>Gallery</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.xs,
  },
  previewContainer: {
    alignItems: 'center',
  },
  thumbnail: {
    width: '100%',
    height: 80,
    borderRadius: borderRadius.md,
    backgroundColor: colors.gray100,
  },
  statusText: {
    fontSize: fontSize.xs,
    color: colors.green,
    fontWeight: '600',
    marginTop: 2,
  },
  emptySlot: {
    height: 80,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.gray300,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: fontSize.xs,
    color: colors.gray400,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  actionButton: {
    flex: 1,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
  },
  scanButton: {
    backgroundColor: colors.primary,
  },
  scanButtonText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.white,
  },
  galleryButton: {
    backgroundColor: colors.gray100,
    borderWidth: 1,
    borderColor: colors.gray300,
  },
  galleryButtonText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.gray700,
  },
  disabled: {
    opacity: 0.4,
  },
});
