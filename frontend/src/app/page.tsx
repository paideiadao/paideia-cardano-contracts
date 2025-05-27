import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function HomePage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">
          Decentralized Governance on Cardano
        </h1>
        <p className="text-xl text-muted-foreground mb-8">
          Create DAOs, vote on proposals, and manage treasuries with on-chain
          governance tokens
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 mb-12">
        <Card>
          <CardHeader>
            <CardTitle>Create a DAO</CardTitle>
            <CardDescription>
              Bootstrap a new decentralized organization with custom governance
              parameters
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full">Create DAO</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Join Existing DAO</CardTitle>
            <CardDescription>
              Connect your wallet to participate in governance and voting
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="secondary" className="w-full">
              Browse DAOs
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Getting Started</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Connect your Cardano wallet</li>
            <li>Create a new DAO or join an existing one</li>
            <li>Lock governance tokens to participate in voting</li>
            <li>Create proposals and vote on community decisions</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
