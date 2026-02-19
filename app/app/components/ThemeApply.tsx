import { useEffect } from "react";
import type { UserTheme } from "~/lib/theme/constants";
import { applyTheme } from "~/lib/theme/apply";

interface ThemeApplyProps {
  userTheme: UserTheme | null | undefined;
}

export function ThemeApply({ userTheme }: ThemeApplyProps) {
  useEffect(() => {
    applyTheme(userTheme);
  }, [userTheme?.theme, userTheme?.style]);

  return null;
}
