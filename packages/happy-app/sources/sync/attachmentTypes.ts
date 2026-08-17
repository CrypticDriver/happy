/**
 * Shared types for image attachment upload pipeline.
 * Defined here (not in hooks/) to avoid circular dependencies:
 * hooks/ imports from sync/, so sync/ cannot import from hooks/.
 */

export type AttachmentPreview = {
    /** Stable unique identifier for use as React key and for removal. */
    id: string;
    uri: string;
    width: number;
    height: number;
    mimeType: string;
    /** May be 0 if the system did not provide the file size. */
    size: number;
    name: string;
    thumbhash?: string;
};

/**
 * True when an attachment is a real image that can be rendered with <Image>.
 *
 * The picker pipeline is shared between pickImages() and pickFiles() (see
 * hooks/useImagePicker.ts), so `selectedImages` is a mixed bag of images and
 * arbitrary files. Anything deciding "can I draw this as a thumbnail?" or
 * "which picker button should light up?" must branch on this rather than on
 * the array being non-empty.
 *
 * pickFiles() sets width/height to 0 and omits thumbhash for non-images, but
 * mimeType is the authoritative signal.
 */
export function isImageAttachment(attachment: Pick<AttachmentPreview, 'mimeType'>): boolean {
    return attachment.mimeType.startsWith('image/');
}

/** Result of a successful attachment upload — ready to build a file event. */
export type UploadedAttachment = {
    ref: string;
    name: string;
    size: number;
    width: number;
    height: number;
    thumbhash?: string;
};
