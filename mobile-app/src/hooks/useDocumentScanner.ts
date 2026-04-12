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

export function useDocumentScanner() {
  const scanPages = useCallback(async (): Promise<ScannedPage[]> => {
    try {
      const result = await DocumentScanner.scanDocument({
        maxNumDocuments: 2,
      });

      if (!result.scannedImages || result.scannedImages.length === 0) {
        return [];
      }

      const pages: ScannedPage[] = result.scannedImages.map((uri, index) => ({
        uri: Platform.OS === 'android' ? uri : uri,
        mimeType: 'image/jpeg',
        fileName: `scan-page-${index + 1}.jpg`,
      }));

      if (pages.length > 2) {
        Alert.alert(
          'Extra pages',
          `${pages.length} pages scanned, using first 2.`,
        );
      }

      return pages.slice(0, 2);
    } catch (error) {
      if (error instanceof Error && error.message?.includes('cancel')) {
        return [];
      }
      Alert.alert('Scanner Error', 'Unable to open document scanner.');
      return [];
    }
  }, []);

  const scanSinglePage = useCallback(async (): Promise<ScannedPage | null> => {
    try {
      const result = await DocumentScanner.scanDocument({
        maxNumDocuments: 1,
      });

      if (!result.scannedImages || result.scannedImages.length === 0) {
        return null;
      }

      return {
        uri: result.scannedImages[0],
        mimeType: 'image/jpeg',
        fileName: 'scan-page.jpg',
      };
    } catch (error) {
      if (error instanceof Error && error.message?.includes('cancel')) {
        return null;
      }
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
