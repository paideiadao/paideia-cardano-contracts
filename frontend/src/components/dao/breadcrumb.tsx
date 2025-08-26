"use client";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useDaoContext } from "@/contexts/dao-context";
import { DAOInfo } from "@/app/api/dao/info/route";

interface BreadcrumbSegment {
  label: string;
  href?: string;
  isCurrentPage?: boolean;
}

export function DaoBreadcrumb() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { daoInfo, isLoading } = useDaoContext();

  if (isLoading || !daoInfo) {
    return null;
  }

  const segments = buildBreadcrumbSegments(pathname, searchParams, daoInfo);

  return (
    <Breadcrumb className="mb-6">
      <BreadcrumbList>
        {segments.map((segment, index) => (
          <div key={index} className="flex items-center">
            <BreadcrumbItem>
              {segment.isCurrentPage ? (
                <BreadcrumbPage>{segment.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink href={segment.href}>
                  {segment.label}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {index < segments.length - 1 && <BreadcrumbSeparator />}
          </div>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function buildBreadcrumbSegments(
  pathname: string,
  searchParams: URLSearchParams,
  daoInfo: DAOInfo
): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = [
    { label: "Browse DAOs", href: "/browse-daos" },
    {
      label: daoInfo.name,
      href: `/dao?daoPolicyId=${daoInfo.policyId}&daoKey=${daoInfo.assetName}`,
    },
  ];

  // If we're just on the DAO page, mark it as current
  if (pathname === "/dao") {
    segments[segments.length - 1].isCurrentPage = true;
    return segments;
  }

  // Split the path and remove empty parts
  const pathParts = pathname.split("/").filter(Boolean);

  // Remove 'dao' from the beginning since we already have that
  if (pathParts[0] === "dao") {
    pathParts.shift();
  }

  // Build breadcrumbs dynamically based on path structure
  let currentPath = "/dao";

  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];
    currentPath += `/${part}`;

    // Determine if this is the last segment (current page)
    const isCurrentPage = i === pathParts.length - 1;

    // Get the display label for this path segment
    const label = getSegmentLabel(part, searchParams, pathParts, i);

    // Build the href with appropriate query parameters
    const href = isCurrentPage
      ? undefined
      : buildSegmentHref(currentPath, searchParams, pathParts, i);

    segments.push({
      label,
      href,
      isCurrentPage,
    });
  }

  return segments;
}

function getSegmentLabel(
  segment: string,
  searchParams: URLSearchParams,
  pathParts: string[],
  index: number
): string {
  switch (segment) {
    case "create-proposal":
      return "Create Proposal";
    case "register":
      return "Register";
    case "unregister":
      return "Unregister";
    case "evaluation":
      return "Evaluation";
    case "execute-action":
      return "Execute Action";
    case "proposal":
      // For proposal, try to get the actual proposal name
      const proposalName = getProposalName(searchParams);
      return proposalName ?? "Proposal";
    default:
      // Capitalize first letter for unknown segments
      return segment.charAt(0).toUpperCase() + segment.slice(1);
  }
}

function buildSegmentHref(
  currentPath: string,
  searchParams: URLSearchParams,
  pathParts: string[],
  index: number
): string {
  // For most pages, just add the DAO parameters
  const baseParams = new URLSearchParams();

  // Always include DAO parameters
  const daoPolicyId = searchParams.get("daoPolicyId");
  const daoKey = searchParams.get("daoKey");
  if (daoPolicyId) baseParams.set("daoPolicyId", daoPolicyId);
  if (daoKey) baseParams.set("daoKey", daoKey);

  // For proposal pages, also include proposal parameters
  if (
    pathParts.includes("proposal") &&
    index >= pathParts.indexOf("proposal")
  ) {
    const proposalPolicyId = searchParams.get("proposalPolicyId");
    const proposalAssetName = searchParams.get("proposalAssetName");
    if (proposalPolicyId) baseParams.set("proposalPolicyId", proposalPolicyId);
    if (proposalAssetName)
      baseParams.set("proposalAssetName", proposalAssetName);
  }

  return `${currentPath}?${baseParams.toString()}`;
}

function getProposalName(searchParams: URLSearchParams): string | null {
  return searchParams.get("proposalName") ?? searchParams.get("name");
}
