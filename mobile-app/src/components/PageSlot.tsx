import React from 'react';
import {
  Image,
  Platform,
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
  const displayUri = imageUri || imageUrl;
  const hasImage = !!displayUri;
  const isSaved = !imageUri && !!imageUrl;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Page {pageNumber}</Text>

      {hasImage ? (
        <Pressable onPress={onPreview} style={styles.previewContainer}>
          <Image source={{ uri: displayUri! }} style={styles.thumbnail} resizeMode="cover" />
          <View style={[styles.statusTag, isSaved ? styles.savedTag : styles.readyTag]}>
            <Text style={[styles.statusTagText, isSaved ? styles.savedTagText : styles.readyTagText]}>
              {isSaved ? 'Saved' : 'Ready'}
            </Text>
          </View>
        </Pressable>
      ) : (
        <View style={styles.emptySlot}>
          <Text style={styles.emptyIcon}>📄</Text>
          <Text style={styles.emptyText}>No image</Text>
        </View>
      )}

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
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    color: colors.gray500,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  previewContainer: {
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: 90,
    borderRadius: borderRadius.md,
    backgroundColor: colors.gray100,
  },
  statusTag: {
    position: 'absolute',
    bottom: spacing.xs,
    right: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  savedTag: {
    backgroundColor: '#DCFCE7',
  },
  readyTag: {
    backgroundColor: '#DBEAFE',
  },
  savedTagText: {
    color: '#166534',
  },
  readyTagText: {
    color: '#1E40AF',
  },
  statusTagText: {
    fontSize: 10,
    fontWeight: '600',
  },
  emptySlot: {
    height: 90,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.gray300,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.gray50,
  },
  emptyIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  emptyText: {
    fontSize: fontSize.xs,
    color: colors.gray400,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  button: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  scanBtn: {
    backgroundColor: colors.primary,
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
