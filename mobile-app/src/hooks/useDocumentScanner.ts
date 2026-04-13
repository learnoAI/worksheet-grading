import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import DocumentScanner from 'react-native-document-scanner-plugin';

export interface ScannedPage {
  uri: string;
  mimeType: string;
  fileName: string;
  width?: number;
  height?: number;
  fileSize?: number;
}

function isCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message?.toLowerCase() || '';
  return msg.includes('cancel') || msg.includes('user') || msg.includes('dismissed');
}

async function scanOne(pageLabel: string): Promise<ScannedPage | null> {
  const result = await DocumentScanner.scanDocument({
    maxNumDocuments: 1,
  });

  if (!result.scannedImages || result.scannedImages.length === 0) {
    return null;
  }

  return {
    uri: result.scannedImages[0],
    mimeType: 'image/jpeg',
    fileName: `scan-${pageLabel}.jpg`,
  };
}

export function useDocumentScanner() {
  // Scan both pages sequentially — opens scanner for page 1, then page 2
  const scanPages = useCallback(async (): Promise<ScannedPage[]> => {
    try {
      // Page 1
      const page1 = await scanOne('page-1');
      if (!page1) return [];

      // Brief pause so the scanner UI can fully dismiss before reopening
      await new Promise((r) => setTimeout(r, 500));

      // Page 2
      const page2 = await scanOne('page-2');
      if (!page2) return [page1]; // User cancelled page 2, keep page 1

      return [page1, page2];
    } catch (error) {
      if (isCancellation(error)) return [];
      Alert.alert('Scanner Error', 'Unable to open document scanner.');
      return [];
    }
  }, []);

  const scanSinglePage = useCallback(async (): Promise<ScannedPage | null> => {
    try {
      return await scanOne('page');
    } catch (error) {
      if (isCancellation(error)) return null;
      Alert.alert('Scanner Error', 'Unable to open document scanner.');
      return null;
    }
  }, []);

  const pickFromGallery = useCallback(async (): Promise<ScannedPage | null> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Required', 'Please allow photo library access.');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      exif: true,
    });

    if (result.canceled || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    return {
      uri: asset.uri,
      mimeType: asset.mimeType || 'image/jpeg',
      fileName: asset.fileName || `gallery-${Date.now()}.jpg`,
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize ?? undefined,
    };
  }, []);

  return { scanPages, scanSinglePage, pickFromGallery };
}
