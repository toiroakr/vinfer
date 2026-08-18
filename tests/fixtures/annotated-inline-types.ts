/**
 * Optional properties that spell `| undefined` out. A mapped type copying one
 * of these prints the union and then has the printer append `| undefined` again
 * for the optional key, which is what the generated types must not carry.
 */
export type AnnotatedMeta = {
  required?: boolean | undefined;
  label?: string | undefined;
};

export type AnnotatedNodeShape = {
  kind: string;
  meta: AnnotatedMeta;
};
