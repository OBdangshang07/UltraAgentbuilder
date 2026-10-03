// Library definitions are not expanded geometry. A multi-package scene can
// retain many small templates while each edit and all actual work stay bounded.
export const SCENE_COLLECTION_LIMITS = Object.freeze({components:256,modules:256,palette:64,reservations:128});
export const SCENE_EDIT_LIMITS = Object.freeze({components:256,modules:32,palette:64,reservations:128});
