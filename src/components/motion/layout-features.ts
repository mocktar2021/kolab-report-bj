import { domMax } from "motion/react";

// Animation and layout features for <LazyMotion>. nav-highlight.tsx imports
// them, and both load in their own chunk when the pointer or the focus first
// reaches the sidebar (KRB-212).
export default domMax;
