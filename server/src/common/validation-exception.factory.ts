import { BadRequestException, ValidationError } from '@nestjs/common';

type ValidationIssue = {
  field: string;
  messages: string[];
};

export function createValidationException(errors: ValidationError[]) {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'Request validation failed',
    details: flattenValidationErrors(errors),
  });
}

function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ValidationIssue[] {
  return errors.flatMap((error) => {
    const fieldPath = parentPath ? `${parentPath}.${error.property}` : error.property;
    const ownMessages = Object.values(error.constraints ?? {});
    const children = flattenValidationErrors(error.children ?? [], fieldPath);

    return ownMessages.length
      ? [{ field: fieldPath, messages: ownMessages }, ...children]
      : children;
  });
}
