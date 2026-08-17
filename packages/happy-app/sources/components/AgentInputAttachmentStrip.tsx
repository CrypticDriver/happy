/**
 * Horizontal scrollable strip showing selected attachment thumbnails.
 * Each entry has a remove button.
 *
 * Images render as thumbnails (thumbhash acts as a blurry placeholder while
 * the full image loads). Arbitrary files picked via pickFiles() are NOT
 * images — handing their uri to <Image> just paints an empty box, so they get
 * a document icon plus name/size instead.
 */
import * as React from 'react';
import { ScrollView, View, Pressable, Text } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { AttachmentPreview } from '@/sync/attachmentTypes';
import { isImageAttachment } from '@/sync/attachmentTypes';
import { thumbhashToDataUri } from '@/utils/thumbhash';

const THUMB_SIZE = 64;
const BORDER_RADIUS = 8;

/** Compact size label for the non-image tile, e.g. "12.4 MB". */
function formatSize(bytes: number): string | undefined {
    if (!bytes || bytes <= 0) return undefined;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AgentInputAttachmentStripProps {
    images: AttachmentPreview[];
    onRemove: (id: string) => void;
}

export function AgentInputAttachmentStrip({ images, onRemove }: AgentInputAttachmentStripProps) {
    const { theme } = useUnistyles();

    if (images.length === 0) return null;

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.strip}
            contentContainerStyle={styles.stripContent}
            keyboardShouldPersistTaps="always"
        >
            {images.map((img) => (
                <AttachmentThumbnail
                    key={img.id}
                    image={img}
                    onRemove={onRemove}
                    theme={theme}
                />
            ))}
        </ScrollView>
    );
}

function AttachmentThumbnail({
    image,
    onRemove,
    theme,
}: {
    image: AttachmentPreview;
    onRemove: (id: string) => void;
    theme: any;
}) {
    // Build placeholder from thumbhash if available
    const placeholder = React.useMemo(() => {
        if (!image.thumbhash) return undefined;
        const uri = thumbhashToDataUri(image.thumbhash);
        return uri ? { uri } : undefined;
    }, [image.thumbhash]);

    const isImage = isImageAttachment(image);
    const sizeLabel = formatSize(image.size);

    return (
        <View style={[
            styles.thumbContainer,
            { borderColor: theme.colors.divider }
        ]}>
            {isImage ? (
                <Image
                    source={{ uri: image.uri }}
                    placeholder={placeholder}
                    style={[{ width: THUMB_SIZE, height: THUMB_SIZE }, styles.thumb]}
                    contentFit="cover"
                    transition={150}
                />
            ) : (
                <View style={[
                    { width: THUMB_SIZE, height: THUMB_SIZE },
                    styles.fileTile,
                    { backgroundColor: theme.colors.surfaceHigh },
                ]}>
                    <Ionicons
                        name="document-outline"
                        size={20}
                        color={theme.colors.button.secondary.tint}
                    />
                    <Text
                        style={[styles.fileName, { color: theme.colors.text }]}
                        numberOfLines={1}
                        ellipsizeMode="middle"
                    >
                        {image.name}
                    </Text>
                    {sizeLabel && (
                        <Text style={[styles.fileSize, { color: theme.colors.button.secondary.tint }]}>
                            {sizeLabel}
                        </Text>
                    )}
                </View>
            )}
            {/* Remove button */}
            <Pressable
                onPress={() => onRemove(image.id)}
                hitSlop={4}
                style={(p) => [
                    styles.removeButton,
                    { backgroundColor: theme.colors.surfaceHigh, opacity: p.pressed ? 0.7 : 1 }
                ]}
            >
                <Ionicons name="close" size={10} color={theme.colors.text} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    strip: {
        marginBottom: 8,
        marginHorizontal: 8,
    },
    stripContent: {
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 4,
    },
    thumbContainer: {
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        borderRadius: BORDER_RADIUS,
        overflow: 'visible',
        borderWidth: 1,
        position: 'relative',
    },
    thumb: {
        borderRadius: BORDER_RADIUS,
    },
    fileTile: {
        borderRadius: BORDER_RADIUS,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
        gap: 2,
    },
    fileName: {
        fontSize: 8,
        maxWidth: THUMB_SIZE - 8,
        textAlign: 'center',
    },
    fileSize: {
        fontSize: 8,
    },
    removeButton: {
        position: 'absolute',
        top: -6,
        right: -6,
        width: 18,
        height: 18,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
    },
}));
